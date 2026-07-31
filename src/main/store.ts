// DataStore: owns the two SQLite files in the app-data dir.
//   reference.db — Scryfall printings, read-only after import, replaceable.
//   inventory.db — the shop's stock. Precious. Survives app reinstalls.
// Electron-free on purpose: the caller passes dataDir, so the same code runs
// under plain Node for scripts/tests. Keep all SQL behind this class so a
// future engine swap (e.g. sql.js) only touches this file and refdb.ts.

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

import {
  REF_SCHEMA,
  REF_INDEXES,
  normalizeSetCode,
  normalizeCollectorNumber,
  rowToCardRef
} from './refdb'
import type {
  CardRef,
  Finish,
  InventoryItem,
  InventorySummary,
  RefStatus,
  ScanResolution
} from '../shared/types'
import type { CornerParse } from './cornerParse'

const INV_SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  rarity           TEXT NOT NULL DEFAULT '',
  type_line        TEXT NOT NULL DEFAULT '',
  mana_cost        TEXT NOT NULL DEFAULT '',
  colors           TEXT NOT NULL DEFAULT '[]',
  finish           TEXT NOT NULL CHECK (finish IN ('nonfoil','foil','etched')),
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  image_uri        TEXT,
  added_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scryfall_id, finish)
);
CREATE INDEX IF NOT EXISTS idx_inv_name ON inventory (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inv_set ON inventory (set_code);

-- One row per scan/add event: what came in, at what market price, when (UTC).
CREATE TABLE IF NOT EXISTS scan_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  finish           TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  price_usd        REAL,
  scanned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_scanlog_stack ON scan_log (scryfall_id, finish, id);
`

/** Market price for a finish; etched falls back to foil (bulk data has no etched price). */
function priceForFinish(pricesUsd: number | null, pricesUsdFoil: number | null, finish: Finish): number | null {
  return finish === 'nonfoil' ? pricesUsd : (pricesUsdFoil ?? pricesUsd)
}

interface InvRow {
  id: number
  scryfall_id: string
  name: string
  set_code: string
  collector_number: string
  rarity: string
  type_line: string
  mana_cost: string
  colors: string
  finish: Finish
  quantity: number
  image_uri: string | null
  added_at: string
  updated_at: string
  last_price: number | null
  last_scanned_at: string | null
}

/** Banded Levenshtein with early exit once distance exceeds `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) >= limit) return limit
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let rowMin = i
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
      if (prev[j] < rowMin) rowMin = prev[j]
    }
    if (rowMin >= limit) return limit
  }
  return prev[b.length]
}

function rowToItem(r: InvRow): InventoryItem {
  return {
    lastPrice: r.last_price ?? null,
    lastScannedAt: r.last_scanned_at ?? null,
    id: r.id,
    scryfallId: r.scryfall_id,
    name: r.name,
    setCode: r.set_code,
    collectorNumber: r.collector_number,
    rarity: r.rarity,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    colors: JSON.parse(r.colors),
    finish: r.finish,
    quantity: r.quantity,
    imageUri: r.image_uri,
    addedAt: r.added_at,
    updatedAt: r.updated_at
  }
}

export class DataStore {
  readonly dataDir: string
  readonly referenceDbPath: string
  readonly inventoryDbPath: string

  private refDb: Database.Database | null = null
  private invDb: Database.Database

  constructor(dataDir: string) {
    this.dataDir = dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    this.referenceDbPath = path.join(dataDir, 'reference.db')
    this.inventoryDbPath = path.join(dataDir, 'inventory.db')

    this.invDb = new Database(this.inventoryDbPath)
    this.invDb.pragma('journal_mode = WAL')
    this.invDb.exec(INV_SCHEMA)

    this.openReferenceIfPresent()
  }

  private openReferenceIfPresent(): void {
    if (this.refDb) return
    if (!fs.existsSync(this.referenceDbPath)) return
    this.refDb = new Database(this.referenceDbPath, { readonly: false })
    this.refDb.exec(REF_SCHEMA)
    this.refDb.exec(REF_INDEXES)
  }

  refStatus(): RefStatus {
    this.openReferenceIfPresent()
    if (!this.refDb) return { ready: false, cardCount: 0, updatedAt: null }
    const count = this.refDb.prepare('SELECT COUNT(*) AS n FROM scryfall_cards').get() as {
      n: number
    }
    const updated = this.refDb
      .prepare("SELECT value FROM meta WHERE key = 'updated_at'")
      .get() as { value: string } | undefined
    return { ready: count.n > 0, cardCount: count.n, updatedAt: updated?.value ?? null }
  }

  /** Close the reference handle, run fn (e.g. swap the file), then reopen. */
  withReferenceClosed(fn: () => void): void {
    this.refDb?.close()
    this.refDb = null
    try {
      fn()
    } finally {
      this.openReferenceIfPresent()
    }
  }

  /** Is this a real set code (or its token set)? Gates the live-API fallback. */
  isKnownSet(setCode: string): boolean {
    this.openReferenceIfPresent()
    if (!this.refDb) return false
    const code = normalizeSetCode(setCode)
    const row = this.refDb
      .prepare('SELECT 1 AS x FROM scryfall_sets WHERE code IN (?, ?) LIMIT 1')
      .get(code, `t${code}`)
    return Boolean(row)
  }

  /** All non-digital sets, newest first — feeds the set-code dropdowns. */
  listSets(): { code: string; name: string }[] {
    this.openReferenceIfPresent()
    if (!this.refDb || !this.hasSetMetadata()) return []
    return this.refDb
      .prepare(
        'SELECT code, name FROM scryfall_sets WHERE digital = 0 ORDER BY released_at DESC'
      )
      .all() as { code: string; name: string }[]
  }

  /** True if set metadata (printed_size) is loaded — needed for old frames. */
  hasSetMetadata(): boolean {
    this.openReferenceIfPresent()
    if (!this.refDb) return false
    const row = this.refDb
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'scryfall_sets'"
      )
      .get() as { n: number }
    if (row.n === 0) return false
    const count = this.refDb.prepare('SELECT COUNT(*) AS n FROM scryfall_sets').get() as {
      n: number
    }
    return count.n > 0
  }

  upsertSets(rows: import('./refdb').ScryfallSetRow[]): void {
    this.openReferenceIfPresent()
    if (!this.refDb) return
    const insert = this.refDb.prepare(`
      INSERT OR REPLACE INTO scryfall_sets
        (code, name, released_at, card_count, printed_size, set_type, digital)
      VALUES (@code, @name, @released_at, @card_count, @printed_size, @set_type, @digital)
    `)
    this.refDb.transaction((all: import('./refdb').ScryfallSetRow[]) => {
      for (const r of all) insert.run(r)
    })(rows)
  }

  /**
   * Resolve an OCR'd corner to a printing.
   * Modern cards: set code + number → direct lookup.
   * No/failed set code: "number/total" identifies the set by its printed size
   * (exactly what the "/150" on the card means); the copyright year breaks
   * ties. Old frames print no set code at all, so this is their only path.
   */
  /**
   * OCR misreads set-code letters on stylized fonts (FIN → "PIN"). When the
   * read code isn't a real set, try every known non-digital set code of the
   * same length within one substitution and see which actually contain this
   * collector number. One survivor → trust it; several → let the operator pick.
   */
  private repairSetCode(badCode: string, collectorNumber: string): CardRef[] {
    this.openReferenceIfPresent()
    if (!this.refDb) return []
    const known = this.refDb
      .prepare('SELECT code FROM scryfall_sets WHERE digital = 0 AND length(code) = ?')
      .all(badCode.length) as { code: string }[]
    const hits: CardRef[] = []
    for (const { code } of known) {
      let diff = 0
      for (let i = 0; i < code.length && diff < 2; i++) {
        if (code[i] !== badCode[i]) diff++
      }
      if (diff !== 1) continue
      const card = this.lookup(code, collectorNumber)
      if (card) hits.push(card)
    }
    return hits
  }

  resolveCorner(parse: CornerParse): ScanResolution {
    if (parse.setCode && parse.number) {
      // Tokens print the parent set's code but live in the t-prefixed token
      // set — and the parent set usually HAS a card at that number, so the
      // token set must win when the T marker was read.
      const setCandidates = parse.token
        ? [`t${parse.setCode}`, parse.setCode]
        : [parse.setCode]
      for (const s of setCandidates) {
        const card = this.lookup(s, parse.number)
        if (card) return { kind: 'exact', card }
      }
      const repaired = this.repairSetCode(parse.setCode, parse.number)
      if (repaired.length === 1) return { kind: 'exact', card: repaired[0] }
      if (repaired.length > 1) {
        return { kind: 'candidates', candidates: repaired.slice(0, 8) }
      }
    }

    if (parse.number && parse.total) {
      this.openReferenceIfPresent()
      if (!this.refDb) return { kind: 'none' }
      const sets = this.refDb
        .prepare(
          `SELECT code, released_at FROM scryfall_sets
           WHERE digital = 0
             AND (printed_size = @total
                  OR (printed_size IS NULL AND card_count = @total))`
        )
        .all({ total: parse.total }) as { code: string; released_at: string | null }[]

      let matches = sets
        .map((s) => ({
          card: this.lookup(s.code, parse.number!),
          year: s.released_at ? Number(s.released_at.slice(0, 4)) : null
        }))
        .filter((m): m is { card: CardRef; year: number | null } => m.card !== null)

      // Progressive year narrowing: exact copyright-year matches beat ±1
      // (a Jan/Feb release can carry the previous year's copyright).
      if (parse.year !== null && matches.length > 1) {
        const exact = matches.filter((m) => m.year === parse.year)
        const near = matches.filter((m) => m.year !== null && Math.abs(m.year - parse.year!) <= 1)
        matches = exact.length > 0 ? exact : near.length > 0 ? near : matches
      }

      if (matches.length === 1) return { kind: 'exact', card: matches[0].card }
      if (matches.length > 1) {
        return { kind: 'candidates', candidates: matches.slice(0, 8).map((m) => m.card) }
      }
    }

    return { kind: 'none' }
  }

  lookup(setCode: string, collectorNumber: string): CardRef | null {
    this.openReferenceIfPresent()
    if (!this.refDb) return null
    const row = this.refDb
      .prepare(
        'SELECT * FROM scryfall_cards WHERE set_code = ? AND collector_number = ? COLLATE NOCASE'
      )
      .get(normalizeSetCode(setCode), normalizeCollectorNumber(collectorNumber))
    return row ? rowToCardRef(row as never, 'local') : null
  }

  byScryfallId(scryfallId: string): CardRef | null {
    this.openReferenceIfPresent()
    if (!this.refDb) return null
    const row = this.refDb
      .prepare('SELECT * FROM scryfall_cards WHERE scryfall_id = ?')
      .get(scryfallId)
    return row ? rowToCardRef(row as never, 'local') : null
  }

  searchByName(query: string, limit = 25): CardRef[] {
    this.openReferenceIfPresent()
    if (!this.refDb) return []
    const rows = this.refDb
      .prepare(
        `SELECT * FROM scryfall_cards WHERE name LIKE ? COLLATE NOCASE
         ORDER BY released_at DESC LIMIT ?`
      )
      .all(`%${query.trim()}%`, limit)
    return rows.map((r) => rowToCardRef(r as never, 'local'))
  }

  /**
   * Match an OCR'd title line to a card name. Exact (case-insensitive)
   * first; then edit-distance ≤2 against names sharing the same first
   * letters. A pinned set narrows printings to one — the old-card flow.
   */
  matchName(
    rawLine: string,
    pinnedSet?: string | null
  ): { resolution: ScanResolution; cleaned: string; quality: 'exact' | 'fuzzy' | 'none' } {
    this.openReferenceIfPresent()
    const cleaned = rawLine
      .replace(/[^A-Za-z'’\-, ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!this.refDb || cleaned.length < 3) {
      return { resolution: { kind: 'none' }, cleaned, quality: 'none' }
    }
    const pin = pinnedSet ? normalizeSetCode(pinnedSet) : null

    const printingsFor = (name: string): CardRef[] => {
      const rows = pin
        ? this.refDb!.prepare(
            `SELECT * FROM scryfall_cards WHERE name = ? COLLATE NOCASE
             AND set_code IN (?, ?) ORDER BY released_at ASC`
          ).all(name, pin, `t${pin}`)
        : this.refDb!.prepare(
            `SELECT * FROM scryfall_cards WHERE name = ? COLLATE NOCASE
             ORDER BY released_at ASC LIMIT 8`
          ).all(name)
      return rows.map((r) => rowToCardRef(r as never, 'local'))
    }

    const resolve = (
      name: string,
      quality: 'exact' | 'fuzzy'
    ): { resolution: ScanResolution; cleaned: string; quality: 'exact' | 'fuzzy' | 'none' } => {
      const printings = printingsFor(name)
      if (printings.length === 0) return { resolution: { kind: 'none' }, cleaned, quality: 'none' }
      if (printings.length === 1) {
        return { resolution: { kind: 'exact', card: printings[0] }, cleaned, quality }
      }
      return { resolution: { kind: 'candidates', candidates: printings }, cleaned, quality }
    }

    const exact = this.refDb
      .prepare('SELECT name FROM scryfall_cards WHERE name = ? COLLATE NOCASE LIMIT 1')
      .get(cleaned) as { name: string } | undefined
    if (exact) return resolve(exact.name, 'exact')

    // Fuzzy: candidate names sharing the first 3 letters, close in length.
    const prefix = cleaned.slice(0, 3)
    const names = this.refDb
      .prepare(
        `SELECT DISTINCT name FROM scryfall_cards
         WHERE name LIKE ? COLLATE NOCASE AND length(name) BETWEEN ? AND ?`
      )
      .all(`${prefix}%`, cleaned.length - 3, cleaned.length + 3) as { name: string }[]
    let bestName: string | null = null
    let bestDist = 3 // accept distance ≤ 2
    const target = cleaned.toLowerCase()
    for (const { name } of names) {
      const d = editDistance(target, name.toLowerCase(), bestDist)
      if (d < bestDist) {
        bestDist = d
        bestName = name
      }
    }
    if (bestName) return resolve(bestName, 'fuzzy')
    return { resolution: { kind: 'none' }, cleaned, quality: 'none' }
  }

  /** Cache a live-API hit so the next scan of the same card is offline. */
  cacheCard(card: CardRef): void {
    this.openReferenceIfPresent()
    if (!this.refDb) return
    this.refDb
      .prepare(
        `INSERT OR REPLACE INTO scryfall_cards
           (scryfall_id, name, set_code, set_name, collector_number, rarity, type_line,
            mana_cost, colors, image_uri, prices_usd, prices_usd_foil, finishes, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        card.scryfallId,
        card.name,
        card.setCode,
        card.setName,
        card.collectorNumber,
        card.rarity,
        card.typeLine,
        card.manaCost,
        JSON.stringify(card.colors),
        card.imageUri,
        card.pricesUsd,
        card.pricesUsdFoil,
        JSON.stringify(card.finishes),
        card.releasedAt
      )
  }

  /**
   * Upsert: same (scryfall_id, finish) stack increments quantity. Every add
   * also appends a scan_log event carrying the market price at scan time
   * and a UTC timestamp.
   */
  addToInventory(card: CardRef, finish: Finish, quantity = 1): InventoryItem {
    const doAdd = this.invDb.transaction(() => {
      this.invDb
        .prepare(
          `INSERT INTO inventory
             (scryfall_id, name, set_code, collector_number, rarity, type_line,
              mana_cost, colors, finish, quantity, image_uri)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (scryfall_id, finish) DO UPDATE SET
             quantity = quantity + excluded.quantity,
             updated_at = datetime('now')`
        )
        .run(
          card.scryfallId,
          card.name,
          card.setCode,
          card.collectorNumber,
          card.rarity,
          card.typeLine,
          card.manaCost,
          JSON.stringify(card.colors),
          finish,
          quantity,
          card.imageUri
        )
      this.invDb
        .prepare(
          `INSERT INTO scan_log
             (scryfall_id, name, set_code, collector_number, finish, quantity, price_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          card.scryfallId,
          card.name,
          card.setCode,
          card.collectorNumber,
          finish,
          quantity,
          priceForFinish(card.pricesUsd, card.pricesUsdFoil, finish)
        )
    })
    doAdd()
    const row = this.invDb
      .prepare('SELECT * FROM inventory WHERE scryfall_id = ? AND finish = ?')
      .get(card.scryfallId, finish) as InvRow
    return rowToItem(row)
  }

  /**
   * Move copies between finish stacks of the same printing (e.g. "that last
   * scan was actually foil"). Creates the target stack from the source row's
   * denormalised fields if needed.
   */
  moveFinish(
    scryfallId: string,
    from: Finish,
    to: Finish,
    quantity = 1
  ): InventoryItem | null {
    if (from === to) return null
    const src = this.invDb
      .prepare('SELECT * FROM inventory WHERE scryfall_id = ? AND finish = ?')
      .get(scryfallId, from) as InvRow | undefined
    if (!src) return null
    const moved = Math.min(quantity, src.quantity)
    const doMove = this.invDb.transaction(() => {
      if (src.quantity - moved <= 0) {
        this.invDb.prepare('DELETE FROM inventory WHERE id = ?').run(src.id)
      } else {
        this.invDb
          .prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?")
          .run(src.quantity - moved, src.id)
      }
      this.invDb
        .prepare(
          `INSERT INTO inventory
             (scryfall_id, name, set_code, collector_number, rarity, type_line,
              mana_cost, colors, finish, quantity, image_uri)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (scryfall_id, finish) DO UPDATE SET
             quantity = quantity + excluded.quantity,
             updated_at = datetime('now')`
        )
        .run(
          src.scryfall_id,
          src.name,
          src.set_code,
          src.collector_number,
          src.rarity,
          src.type_line,
          src.mana_cost,
          src.colors,
          to,
          moved,
          src.image_uri
        )
    })
    doMove()
    // The scan event's finish was a correction, not a new scan: re-point the
    // newest matching log rows and re-price them for the new finish.
    this.openReferenceIfPresent()
    const ref = this.refDb
      ?.prepare('SELECT prices_usd, prices_usd_foil FROM scryfall_cards WHERE scryfall_id = ?')
      .get(scryfallId) as { prices_usd: number | null; prices_usd_foil: number | null } | undefined
    let remaining = moved
    while (remaining > 0) {
      const last = this.invDb
        .prepare(
          `SELECT id, quantity FROM scan_log
           WHERE scryfall_id = ? AND finish = ? ORDER BY id DESC LIMIT 1`
        )
        .get(scryfallId, from) as { id: number; quantity: number } | undefined
      if (!last) break
      const take = Math.min(last.quantity, remaining)
      if (take === last.quantity) {
        this.invDb
          .prepare('UPDATE scan_log SET finish = ?, price_usd = ? WHERE id = ?')
          .run(to, ref ? priceForFinish(ref.prices_usd, ref.prices_usd_foil, to) : null, last.id)
      } else {
        this.invDb
          .prepare('UPDATE scan_log SET quantity = quantity - ? WHERE id = ?')
          .run(take, last.id)
        this.invDb
          .prepare(
            `INSERT INTO scan_log
               (scryfall_id, name, set_code, collector_number, finish, quantity, price_usd, scanned_at)
             SELECT scryfall_id, name, set_code, collector_number, ?, ?, ?, scanned_at
             FROM scan_log WHERE id = ?`
          )
          .run(to, take, ref ? priceForFinish(ref.prices_usd, ref.prices_usd_foil, to) : null, last.id)
      }
      remaining -= take
    }
    const row = this.invDb
      .prepare('SELECT * FROM inventory WHERE scryfall_id = ? AND finish = ?')
      .get(scryfallId, to) as InvRow
    return rowToItem(row)
  }

  /** Trim the newest scan_log events for a stack by `quantity` copies. */
  private retractScanLog(scryfallId: string, finish: Finish, quantity: number): void {
    let remaining = quantity
    while (remaining > 0) {
      const last = this.invDb
        .prepare(
          `SELECT id, quantity FROM scan_log
           WHERE scryfall_id = ? AND finish = ? ORDER BY id DESC LIMIT 1`
        )
        .get(scryfallId, finish) as { id: number; quantity: number } | undefined
      if (!last) return
      if (last.quantity > remaining) {
        this.invDb
          .prepare('UPDATE scan_log SET quantity = quantity - ? WHERE id = ?')
          .run(remaining, last.id)
        return
      }
      this.invDb.prepare('DELETE FROM scan_log WHERE id = ?').run(last.id)
      remaining -= last.quantity
    }
  }

  /**
   * Decrement a stack; the row is deleted when it reaches zero. The newest
   * scan_log events are retracted with it (an undone scan didn't happen).
   */
  removeFromInventory(
    scryfallId: string,
    finish: Finish,
    quantity = 1
  ): InventoryItem | null {
    const row = this.invDb
      .prepare('SELECT * FROM inventory WHERE scryfall_id = ? AND finish = ?')
      .get(scryfallId, finish) as InvRow | undefined
    if (!row) return null
    const newQty = row.quantity - quantity
    const doRemove = this.invDb.transaction(() => {
      if (newQty <= 0) {
        this.invDb.prepare('DELETE FROM inventory WHERE id = ?').run(row.id)
      } else {
        this.invDb
          .prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newQty, row.id)
      }
      this.retractScanLog(scryfallId, finish, Math.min(quantity, row.quantity))
    })
    doRemove()
    return rowToItem({ ...row, quantity: Math.max(0, newQty) })
  }

  /**
   * Collection export text. One row per printing, quantities summed across
   * finishes. Formats:
   *   'csv'  → quantity,card-name,expansion,id  (RFC-4180 quoting, "1,Island,fin,297")
   *   'list' → 1 Island (FIN) 297               (plain decklist-with-pins style)
   * Scope 'session' aggregates the scan_log since `sinceIso` (this app run;
   * undos retract their log rows, so the session view stays honest).
   */
  exportText(format: 'csv' | 'list', scope: 'all' | 'session', sinceIso?: string): string {
    const rows = (
      scope === 'session' && sinceIso
        ? this.invDb
            .prepare(
              `SELECT name, set_code, collector_number, SUM(quantity) AS qty
               FROM scan_log WHERE scanned_at >= ?
               GROUP BY name, set_code, collector_number
               ORDER BY name COLLATE NOCASE, set_code, collector_number`
            )
            .all(sinceIso)
        : this.invDb
            .prepare(
              `SELECT name, set_code, collector_number, SUM(quantity) AS qty
               FROM inventory
               GROUP BY name, set_code, collector_number
               ORDER BY name COLLATE NOCASE, set_code, collector_number`
            )
            .all()
    ) as { name: string; set_code: string; collector_number: string; qty: number }[]

    if (format === 'csv') {
      const esc = (s: string): string =>
        /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      return rows
        .map((r) => `${r.qty},${esc(r.name)},${r.set_code},${r.collector_number}`)
        .join('\n')
    }
    return rows
      .map((r) => `${r.qty} ${r.name} (${r.set_code.toUpperCase()}) ${r.collector_number}`)
      .join('\n')
  }

  /** Total market value (USD) of every stack, at current reference prices. */
  private collectionValue(): number {
    this.openReferenceIfPresent()
    if (!this.refDb) return 0
    const priceStmt = this.refDb.prepare(
      'SELECT prices_usd, prices_usd_foil FROM scryfall_cards WHERE scryfall_id = ?'
    )
    const stacks = this.invDb
      .prepare('SELECT scryfall_id, finish, quantity FROM inventory')
      .all() as { scryfall_id: string; finish: Finish; quantity: number }[]
    let total = 0
    for (const s of stacks) {
      const ref = priceStmt.get(s.scryfall_id) as
        | { prices_usd: number | null; prices_usd_foil: number | null }
        | undefined
      const price = ref ? priceForFinish(ref.prices_usd, ref.prices_usd_foil, s.finish) : null
      if (price != null) total += price * s.quantity
    }
    return total
  }

  /** Current market price for one stack, from the reference DB. */
  private stackPrice(scryfallId: string, finish: Finish): number | null {
    this.openReferenceIfPresent()
    if (!this.refDb) return null
    const ref = this.refDb
      .prepare('SELECT prices_usd, prices_usd_foil FROM scryfall_cards WHERE scryfall_id = ?')
      .get(scryfallId) as { prices_usd: number | null; prices_usd_foil: number | null } | undefined
    return ref ? priceForFinish(ref.prices_usd, ref.prices_usd_foil, finish) : null
  }

  /**
   * Scope 'session': only stacks scanned since `sinceIso`, quantities being
   * the SESSION quantities (undos retract their log rows), newest first.
   */
  listInventory(
    limit = 500,
    scope: 'all' | 'session' = 'all',
    sinceIso?: string
  ): InventorySummary {
    if (scope === 'session' && sinceIso) {
      const rows = this.invDb
        .prepare(
          `SELECT i.*, s.qty AS session_qty,
                  (SELECT sl.price_usd FROM scan_log sl
                   WHERE sl.scryfall_id = i.scryfall_id AND sl.finish = i.finish
                   ORDER BY sl.id DESC LIMIT 1) AS last_price,
                  (SELECT sl.scanned_at FROM scan_log sl
                   WHERE sl.scryfall_id = i.scryfall_id AND sl.finish = i.finish
                   ORDER BY sl.id DESC LIMIT 1) AS last_scanned_at
           FROM inventory i
           JOIN (SELECT scryfall_id, finish, SUM(quantity) AS qty, MAX(scanned_at) AS last
                 FROM scan_log WHERE scanned_at >= ?
                 GROUP BY scryfall_id, finish) s
             ON s.scryfall_id = i.scryfall_id AND s.finish = i.finish
           ORDER BY s.last DESC LIMIT ?`
        )
        .all(sinceIso, limit) as (InvRow & { session_qty: number })[]
      let totalCards = 0
      let totalValue = 0
      for (const r of rows) {
        totalCards += r.session_qty
        const price = this.stackPrice(r.scryfall_id, r.finish)
        if (price != null) totalValue += price * r.session_qty
      }
      return {
        items: rows.map((r) => rowToItem({ ...r, quantity: r.session_qty })),
        totalCards,
        distinctStacks: rows.length,
        totalValue
      }
    }
    return this.listAllInventory(limit)
  }

  private listAllInventory(limit = 500): InventorySummary {
    const items = (
      this.invDb
        .prepare(
          `SELECT i.*,
                  (SELECT s.price_usd FROM scan_log s
                   WHERE s.scryfall_id = i.scryfall_id AND s.finish = i.finish
                   ORDER BY s.id DESC LIMIT 1) AS last_price,
                  (SELECT s.scanned_at FROM scan_log s
                   WHERE s.scryfall_id = i.scryfall_id AND s.finish = i.finish
                   ORDER BY s.id DESC LIMIT 1) AS last_scanned_at
           FROM inventory i ORDER BY i.updated_at DESC LIMIT ?`
        )
        .all(limit) as InvRow[]
    ).map(rowToItem)
    const totals = this.invDb
      .prepare('SELECT COALESCE(SUM(quantity), 0) AS total, COUNT(*) AS stacks FROM inventory')
      .get() as { total: number; stacks: number }
    return {
      items,
      totalCards: totals.total,
      distinctStacks: totals.stacks,
      totalValue: this.collectionValue()
    }
  }

  close(): void {
    this.refDb?.close()
    this.refDb = null
    this.invDb.close()
  }
}
