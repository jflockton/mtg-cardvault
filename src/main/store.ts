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
  DeckCard,
  DeckDetail,
  DeckFormat,
  DeckImportResult,
  DeckSummary,
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
-- price_eur is Cardmarket's price at scan time (via Scryfall bulk data).
CREATE TABLE IF NOT EXISTS scan_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  finish           TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  price_usd        REAL,
  price_eur        REAL,
  scanned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_scanlog_stack ON scan_log (scryfall_id, finish, id);
`

// Decks live in inventory.db alongside stock: precious, backed up, and synced
// to Dropbox with the rest. A deck_card row carries the printing's scryfall_id
// (null when an import couldn't resolve it) plus a denormalised name so the row
// survives even before the reference DB knows the card. Card details for
// analysis are joined from reference.db at read time — never copied in.
const DECK_SCHEMA = `
CREATE TABLE IF NOT EXISTS decks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'commander',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deck_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id     INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  scryfall_id TEXT,
  name        TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  category    TEXT NOT NULL DEFAULT '',
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deckcards_deck ON deck_cards (deck_id);
-- Resolved printings stack (one row per printing+board); unresolved rows
-- (null scryfall_id) never collide, so each keeps its own line.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deckcards_stack
  ON deck_cards (deck_id, scryfall_id, category) WHERE scryfall_id IS NOT NULL;
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
  last_price_eur: number | null
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
    lastPriceEur: r.last_price_eur ?? null,
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
  inventoryDir: string
  inventoryDbPath: string

  private refDb: Database.Database | null = null
  private invDb!: Database.Database

  // `inventoryDir` defaults to `dataDir` (everything in one local folder). When
  // the shop moves the inventory into a cloud folder (Dropbox), pass it here —
  // reference.db always stays in the local `dataDir`.
  constructor(dataDir: string, inventoryDir: string = dataDir) {
    this.dataDir = dataDir
    this.inventoryDir = inventoryDir
    fs.mkdirSync(dataDir, { recursive: true })
    this.referenceDbPath = path.join(dataDir, 'reference.db')
    this.inventoryDbPath = ''

    const migratedEur = this.connectInventory()

    this.openReferenceIfPresent()

    // One-time backfill: stamp pre-migration scan events with today's
    // Cardmarket price (approximate — the true scan-time price wasn't recorded).
    if (migratedEur && this.refDb) {
      const stale = this.invDb
        .prepare('SELECT DISTINCT scryfall_id, finish FROM scan_log WHERE price_eur IS NULL')
        .all() as { scryfall_id: string; finish: Finish }[]
      const upd = this.invDb.prepare(
        'UPDATE scan_log SET price_eur = ? WHERE scryfall_id = ? AND finish = ? AND price_eur IS NULL'
      )
      for (const r of stale) {
        const p = this.stackPrice(r.scryfall_id, r.finish)
        if (p.eur != null) upd.run(p.eur, r.scryfall_id, r.finish)
      }
    }
  }

  /**
   * Open (or reopen) inventory.db from `this.inventoryDir`, apply schema and the
   * EUR-price migration. Returns whether the EUR migration was just applied (so
   * the caller can run the one-time price backfill). Safe to call repeatedly.
   *
   * When the inventory lives outside the local data dir it's assumed to be in a
   * cloud-synced folder (Dropbox), so we use a rollback journal instead of WAL:
   * WAL keeps `-wal`/`-shm` sidecar files that a file syncer can copy out of step
   * with the main db and corrupt it. With `journal_mode = DELETE` the committed
   * database is a single self-consistent file between transactions — exactly what
   * a sync client can safely replicate.
   */
  private connectInventory(): boolean {
    this.inventoryDbPath = path.join(this.inventoryDir, 'inventory.db')
    fs.mkdirSync(this.inventoryDir, { recursive: true })
    this.invDb = new Database(this.inventoryDbPath)
    const cloud = path.resolve(this.inventoryDir) !== path.resolve(this.dataDir)
    this.invDb.pragma(cloud ? 'journal_mode = DELETE' : 'journal_mode = WAL')
    this.invDb.pragma('foreign_keys = ON') // deck_cards → decks cascade
    this.invDb.exec(INV_SCHEMA)
    this.invDb.exec(DECK_SCHEMA)
    // Migration: deck tile art, added after the decks tables first shipped.
    const deckCols = this.invDb.prepare('PRAGMA table_info(decks)').all() as { name: string }[]
    if (!deckCols.some((c) => c.name === 'image_uri')) {
      this.invDb.exec('ALTER TABLE decks ADD COLUMN image_uri TEXT')
    }
    // Migration for inventories created before Cardmarket price capture.
    const logCols = this.invDb.prepare('PRAGMA table_info(scan_log)').all() as { name: string }[]
    const migratedEur = !logCols.some((c) => c.name === 'price_eur')
    if (migratedEur) {
      this.invDb.exec('ALTER TABLE scan_log ADD COLUMN price_eur REAL')
    }
    return migratedEur
  }

  /**
   * Move the live inventory to a new folder (e.g. into Dropbox) and reopen it
   * there. The current inventory.db is copied into `newDir` if that folder has
   * none yet; if `newDir` already holds an inventory.db (e.g. Dropbox synced one
   * from another machine) we adopt it in place rather than overwriting. The old
   * local file is left untouched as a safety copy. Returns the new db path.
   */
  relocateInventory(newDir: string): string {
    const from = this.inventoryDbPath
    const resolvedNew = path.resolve(newDir)
    if (resolvedNew === path.resolve(this.inventoryDir)) return this.inventoryDbPath

    // Flush WAL back into the main file before we copy or leave it.
    try {
      this.invDb.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* not in WAL — nothing to flush */
    }
    this.invDb.close()

    fs.mkdirSync(newDir, { recursive: true })
    const target = path.join(newDir, 'inventory.db')
    if (fs.existsSync(from) && !fs.existsSync(target)) {
      fs.copyFileSync(from, target)
    }

    this.inventoryDir = newDir
    this.connectInventory()
    return this.inventoryDbPath
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
             (scryfall_id, name, set_code, collector_number, finish, quantity, price_usd, price_eur)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          card.scryfallId,
          card.name,
          card.setCode,
          card.collectorNumber,
          finish,
          quantity,
          priceForFinish(card.pricesUsd, card.pricesUsdFoil, finish),
          priceForFinish(card.pricesEur, card.pricesEurFoil, finish)
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
      ?.prepare(
        `SELECT prices_usd, prices_usd_foil, prices_eur, prices_eur_foil
         FROM scryfall_cards WHERE scryfall_id = ?`
      )
      .get(scryfallId) as
      | {
          prices_usd: number | null
          prices_usd_foil: number | null
          prices_eur: number | null
          prices_eur_foil: number | null
        }
      | undefined
    const usdFor = ref ? priceForFinish(ref.prices_usd, ref.prices_usd_foil, to) : null
    const eurFor = ref ? priceForFinish(ref.prices_eur, ref.prices_eur_foil, to) : null
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
          .prepare('UPDATE scan_log SET finish = ?, price_usd = ?, price_eur = ? WHERE id = ?')
          .run(to, usdFor, eurFor, last.id)
      } else {
        this.invDb
          .prepare('UPDATE scan_log SET quantity = quantity - ? WHERE id = ?')
          .run(take, last.id)
        this.invDb
          .prepare(
            `INSERT INTO scan_log
               (scryfall_id, name, set_code, collector_number, finish, quantity, price_usd, price_eur, scanned_at)
             SELECT scryfall_id, name, set_code, collector_number, ?, ?, ?, ?, scanned_at
             FROM scan_log WHERE id = ?`
          )
          .run(to, take, usdFor, eurFor, last.id)
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
  exportText(
    format: 'csv' | 'list',
    scope: 'all' | 'session' | 'today' | 'range',
    sinceIso?: string,
    untilIso?: string
  ): string {
    const rows = (
      scope !== 'all' && sinceIso
        ? this.invDb
            .prepare(
              `SELECT name, set_code, collector_number, SUM(quantity) AS qty,
                      MAX(scanned_at) AS imported_at
               FROM scan_log WHERE scanned_at >= ? AND scanned_at <= ?
               GROUP BY name, set_code, collector_number
               ORDER BY name COLLATE NOCASE, set_code, collector_number`
            )
            .all(sinceIso, untilIso ?? '9999-12-31T23:59:59Z')
        : this.invDb
            .prepare(
              `SELECT i.name, i.set_code, i.collector_number, SUM(i.quantity) AS qty,
                      COALESCE(
                        (SELECT MAX(sl.scanned_at) FROM scan_log sl
                         WHERE sl.name = i.name AND sl.set_code = i.set_code
                           AND sl.collector_number = i.collector_number),
                        MAX(i.updated_at)
                      ) AS imported_at
               FROM inventory i
               GROUP BY i.name, i.set_code, i.collector_number
               ORDER BY i.name COLLATE NOCASE, i.set_code, i.collector_number`
            )
            .all()
    ) as {
      name: string
      set_code: string
      collector_number: string
      qty: number
      imported_at: string | null
    }[]

    if (format === 'csv') {
      const esc = (s: string): string =>
        /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      return rows
        .map(
          (r) =>
            `${r.qty},${esc(r.name)},${r.set_code},${r.collector_number},${(r.imported_at ?? '').slice(0, 10)}`
        )
        .join('\n')
    }
    return rows
      .map((r) => `${r.qty} ${r.name} (${r.set_code.toUpperCase()}) ${r.collector_number}`)
      .join('\n')
  }

  /** Total market value (USD + Cardmarket EUR) at current reference prices. */
  private collectionValue(): { usd: number; eur: number } {
    this.openReferenceIfPresent()
    if (!this.refDb) return { usd: 0, eur: 0 }
    const stacks = this.invDb
      .prepare('SELECT scryfall_id, finish, quantity FROM inventory')
      .all() as { scryfall_id: string; finish: Finish; quantity: number }[]
    let usd = 0
    let eur = 0
    for (const s of stacks) {
      const p = this.stackPrice(s.scryfall_id, s.finish)
      if (p.usd != null) usd += p.usd * s.quantity
      if (p.eur != null) eur += p.eur * s.quantity
    }
    return { usd, eur }
  }

  /** Current market prices for one stack, from the reference DB. */
  private stackPrice(scryfallId: string, finish: Finish): { usd: number | null; eur: number | null } {
    this.openReferenceIfPresent()
    if (!this.refDb) return { usd: null, eur: null }
    const ref = this.refDb
      .prepare(
        `SELECT prices_usd, prices_usd_foil, prices_eur, prices_eur_foil
         FROM scryfall_cards WHERE scryfall_id = ?`
      )
      .get(scryfallId) as
      | {
          prices_usd: number | null
          prices_usd_foil: number | null
          prices_eur: number | null
          prices_eur_foil: number | null
        }
      | undefined
    if (!ref) return { usd: null, eur: null }
    return {
      usd: priceForFinish(ref.prices_usd, ref.prices_usd_foil, finish),
      eur: priceForFinish(ref.prices_eur, ref.prices_eur_foil, finish)
    }
  }

  /**
   * Scope 'session': only stacks scanned since `sinceIso`, quantities being
   * the SESSION quantities (undos retract their log rows), newest first.
   */
  listInventory(
    limit = 500,
    scope: 'all' | 'session' | 'today' | 'range' = 'all',
    sinceIso?: string,
    untilIso?: string
  ): InventorySummary {
    if (scope !== 'all' && sinceIso) {
      const rows = this.invDb
        .prepare(
          `SELECT i.*, s.qty AS session_qty,
                  (SELECT sl.price_usd FROM scan_log sl
                   WHERE sl.scryfall_id = i.scryfall_id AND sl.finish = i.finish
                   ORDER BY sl.id DESC LIMIT 1) AS last_price,
                  (SELECT sl.price_eur FROM scan_log sl
                   WHERE sl.scryfall_id = i.scryfall_id AND sl.finish = i.finish
                   ORDER BY sl.id DESC LIMIT 1) AS last_price_eur,
                  (SELECT sl.scanned_at FROM scan_log sl
                   WHERE sl.scryfall_id = i.scryfall_id AND sl.finish = i.finish
                   ORDER BY sl.id DESC LIMIT 1) AS last_scanned_at
           FROM inventory i
           JOIN (SELECT scryfall_id, finish, SUM(quantity) AS qty, MAX(scanned_at) AS last
                 FROM scan_log WHERE scanned_at >= ? AND scanned_at <= ?
                 GROUP BY scryfall_id, finish) s
             ON s.scryfall_id = i.scryfall_id AND s.finish = i.finish
           ORDER BY s.last DESC LIMIT ?`
        )
        .all(sinceIso, untilIso ?? '9999-12-31T23:59:59Z', limit) as (InvRow & {
        session_qty: number
      })[]
      let totalCards = 0
      let totalValue = 0
      let totalValueEur = 0
      for (const r of rows) {
        totalCards += r.session_qty
        const price = this.stackPrice(r.scryfall_id, r.finish)
        if (price.usd != null) totalValue += price.usd * r.session_qty
        if (price.eur != null) totalValueEur += price.eur * r.session_qty
      }
      return {
        items: rows.map((r) => rowToItem({ ...r, quantity: r.session_qty })),
        totalCards,
        distinctStacks: rows.length,
        totalValue,
        totalValueEur
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
                  (SELECT s.price_eur FROM scan_log s
                   WHERE s.scryfall_id = i.scryfall_id AND s.finish = i.finish
                   ORDER BY s.id DESC LIMIT 1) AS last_price_eur,
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
    const value = this.collectionValue()
    return {
      items,
      totalCards: totals.total,
      distinctStacks: totals.stacks,
      totalValue: value.usd,
      totalValueEur: value.eur
    }
  }

  // ---------------------------------------------------------------- viewer

  /**
   * One card entry for the browser viewer. quantity is total owned copies
   * (0 for any-card results the shop doesn't stock); EUR prices are
   * Cardmarket's, via the Scryfall bulk data.
   */
  viewerInventory(): {
    cards: ViewerCard[]
    totalCards: number
    totalValueEur: number
    totalValueUsd: number
  } {
    this.openReferenceIfPresent()
    const refStmt = this.refDb?.prepare(
      `SELECT set_name, prices_usd, prices_usd_foil, prices_eur, prices_eur_foil
       FROM scryfall_cards WHERE scryfall_id = ?`
    )
    const rows = this.invDb
      .prepare(
        `SELECT scryfall_id, name, set_code, collector_number, rarity, type_line,
                finish, quantity, image_uri
         FROM inventory WHERE quantity > 0 ORDER BY name COLLATE NOCASE, finish`
      )
      .all() as {
      scryfall_id: string
      name: string
      set_code: string
      collector_number: string
      rarity: string
      type_line: string
      finish: Finish
      quantity: number
      image_uri: string | null
    }[]

    const byId = new Map<string, ViewerCard>()
    let totalCards = 0
    let totalValueEur = 0
    let totalValueUsd = 0
    for (const r of rows) {
      let card = byId.get(r.scryfall_id)
      if (!card) {
        const ref = refStmt?.get(r.scryfall_id) as
          | {
              set_name: string
              prices_usd: number | null
              prices_usd_foil: number | null
              prices_eur: number | null
              prices_eur_foil: number | null
            }
          | undefined
        card = {
          scryfallId: r.scryfall_id,
          name: r.name,
          setCode: r.set_code,
          setName: ref?.set_name || this.setNameFor(r.set_code),
          collectorNumber: r.collector_number,
          rarity: r.rarity,
          typeLine: r.type_line,
          imageUri: r.image_uri,
          quantity: 0,
          stacks: [],
          priceUsd: ref?.prices_usd ?? null,
          priceUsdFoil: ref?.prices_usd_foil ?? null,
          priceEur: ref?.prices_eur ?? null,
          priceEurFoil: ref?.prices_eur_foil ?? null
        }
        byId.set(r.scryfall_id, card)
      }
      card.stacks.push({ finish: r.finish, quantity: r.quantity })
      card.quantity += r.quantity
      totalCards += r.quantity
      const usd = priceForFinish(card.priceUsd, card.priceUsdFoil, r.finish)
      const eur = priceForFinish(card.priceEur, card.priceEurFoil, r.finish)
      if (usd != null) totalValueUsd += usd * r.quantity
      if (eur != null) totalValueEur += eur * r.quantity
    }
    return { cards: [...byId.values()], totalCards, totalValueEur, totalValueUsd }
  }

  /**
   * Any-card mode: search or browse the whole reference DB, paged. With no
   * name and no set this browses EVERYTHING (name order) — the page size
   * keeps that light.
   */
  viewerSearch(
    nameQuery: string,
    setCode: string,
    limit = 300,
    offset = 0,
    f: {
      type?: string
      subtype?: string
      rarities?: string[]
      commander?: boolean
      foil?: boolean
    } = {}
  ): { cards: ViewerCard[]; total: number } {
    this.openReferenceIfPresent()
    if (!this.refDb) return { cards: [], total: 0 }
    const name = nameQuery.trim()
    const set = setCode.trim().toLowerCase()

    const where: string[] = []
    const params: (string | number)[] = []
    if (name) {
      where.push('name LIKE ? COLLATE NOCASE')
      params.push(`%${name}%`)
    }
    if (set) {
      where.push('set_code = ?')
      params.push(set)
    }
    // Filters run in SQL so pagination pages over the FILTERED results —
    // a Villain browse fills whole pages with Villains.
    if (f.type) {
      where.push('type_line LIKE ? COLLATE NOCASE')
      params.push(`%${f.type.trim()}%`)
    }
    if (f.subtype) {
      const terms = f.subtype.split(',').map((s) => s.trim()).filter(Boolean)
      if (terms.length > 0) {
        where.push(`(${terms.map(() => 'type_line LIKE ? COLLATE NOCASE').join(' OR ')})`)
        for (const t of terms) params.push(`%${t}%`)
      }
    }
    if (f.rarities && f.rarities.length > 0) {
      where.push(`rarity IN (${f.rarities.map(() => '?').join(',')})`)
      params.push(...f.rarities)
    }
    if (f.commander) where.push("type_line LIKE '%Legendary Creature%'")
    if (f.foil) where.push('(prices_eur_foil IS NOT NULL OR prices_usd_foil IS NOT NULL)')
    const whereSql = where.length > 0 ? where.join(' AND ') : '1=1'
    // Set browse reads in collector order; everything else alphabetically.
    const order = set && !name
      ? 'ORDER BY CAST(collector_number AS INTEGER), collector_number'
      : 'ORDER BY name COLLATE NOCASE, released_at DESC'
    const total = (
      this.refDb
        .prepare(`SELECT COUNT(*) AS n FROM scryfall_cards WHERE ${whereSql}`)
        .get(...params) as { n: number }
    ).n
    const rows = this.refDb
      .prepare(
        `SELECT * FROM scryfall_cards WHERE ${whereSql} ${order} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as {
      scryfall_id: string
      name: string
      set_code: string
      set_name: string
      collector_number: string
      rarity: string
      type_line: string
      image_uri: string | null
      prices_usd: number | null
      prices_usd_foil: number | null
      prices_eur: number | null
      prices_eur_foil: number | null
    }[]

    const owned = new Map<string, number>()
    for (const o of this.invDb
      .prepare('SELECT scryfall_id, SUM(quantity) AS qty FROM inventory GROUP BY scryfall_id')
      .all() as { scryfall_id: string; qty: number }[]) {
      owned.set(o.scryfall_id, o.qty)
    }

    const cards = rows.map((r) => ({
      scryfallId: r.scryfall_id,
      name: r.name,
      setCode: r.set_code,
      setName: r.set_name || this.setNameFor(r.set_code),
      collectorNumber: r.collector_number,
      rarity: r.rarity,
      typeLine: r.type_line,
      imageUri: r.image_uri,
      quantity: owned.get(r.scryfall_id) ?? 0,
      stacks: [],
      priceUsd: r.prices_usd,
      priceUsdFoil: r.prices_usd_foil,
      priceEur: r.prices_eur,
      priceEurFoil: r.prices_eur_foil
    }))
    return { cards, total }
  }

  /**
   * Sets for the viewer dropdown. With filters active, only sets that
   * CONTAIN matching cards are returned (with match counts) — pick
   * "Villain" and the dropdown offers only sets holding Villains.
   */
  viewerSets(
    mode: 'inventory' | 'all',
    f: {
      name?: string
      type?: string
      subtype?: string
      rarities?: string[]
      commander?: boolean
      foil?: boolean
    } = {}
  ): { code: string; name: string; count: number }[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (f.name?.trim()) {
      where.push('name LIKE ? COLLATE NOCASE')
      params.push(`%${f.name.trim()}%`)
    }
    if (f.type?.trim()) {
      where.push('type_line LIKE ? COLLATE NOCASE')
      params.push(`%${f.type.trim()}%`)
    }
    if (f.subtype?.trim()) {
      const terms = f.subtype.split(',').map((s) => s.trim()).filter(Boolean)
      if (terms.length > 0) {
        where.push(`(${terms.map(() => 'type_line LIKE ? COLLATE NOCASE').join(' OR ')})`)
        for (const t of terms) params.push(`%${t}%`)
      }
    }
    if (f.rarities && f.rarities.length > 0) {
      where.push(`rarity IN (${f.rarities.map(() => '?').join(',')})`)
      params.push(...f.rarities)
    }
    if (f.commander) where.push("type_line LIKE '%Legendary Creature%'")

    if (mode === 'all') {
      this.openReferenceIfPresent()
      if (!this.refDb) return []
      if (f.foil) where.push('(prices_eur_foil IS NOT NULL OR prices_usd_foil IS NOT NULL)')
      if (where.length === 0) {
        return this.listSets().map((s) => ({ ...s, count: 0 }))
      }
      const rows = this.refDb
        .prepare(
          `SELECT set_code, MAX(set_name) AS set_name, COUNT(*) AS n
           FROM scryfall_cards WHERE ${where.join(' AND ')}
           GROUP BY set_code ORDER BY set_name COLLATE NOCASE`
        )
        .all(...params) as { set_code: string; set_name: string; n: number }[]
      return rows.map((r) => ({
        code: r.set_code,
        name: r.set_name || this.setNameFor(r.set_code),
        count: r.n
      }))
    }

    if (f.foil) where.push("finish != 'nonfoil'")
    where.push('quantity > 0')
    const rows = this.invDb
      .prepare(
        `SELECT set_code, SUM(quantity) AS qty FROM inventory
         WHERE ${where.join(' AND ')} GROUP BY set_code`
      )
      .all(...params) as { set_code: string; qty: number }[]
    return rows
      .map((r) => ({ code: r.set_code, name: this.setNameFor(r.set_code), count: r.qty }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Viewer stock buttons: +1 adds a copy (logged like a scan), −1 removes. */
  viewerAdjust(scryfallId: string, finish: Finish, delta: number): boolean {
    if (!scryfallId || !Number.isFinite(delta) || delta === 0) return false
    if (delta > 0) {
      const card = this.byScryfallId(scryfallId)
      if (!card) return false
      this.addToInventory(card, finish, delta)
      return true
    }
    return this.removeFromInventory(scryfallId, finish, -delta) != null
  }

  private setNameFor(code: string): string {
    this.openReferenceIfPresent()
    if (this.refDb && this.hasSetMetadata()) {
      const row = this.refDb
        .prepare('SELECT name FROM scryfall_sets WHERE code = ?')
        .get(code.toLowerCase()) as { name: string } | undefined
      if (row?.name) return row.name
    }
    return code.toUpperCase()
  }

  // ------------------------------------------------------------------ decks

  listDecks(): DeckSummary[] {
    const rows = this.invDb
      .prepare(
        `SELECT d.id, d.name, d.format, d.image_uri, d.created_at, d.updated_at,
                COALESCE((SELECT SUM(quantity) FROM deck_cards dc
                          WHERE dc.deck_id = d.id
                            AND dc.category IN ('', 'commander')), 0) AS card_count
         FROM decks d ORDER BY d.updated_at DESC`
      )
      .all() as {
      id: number
      name: string
      format: string
      image_uri: string | null
      created_at: string
      updated_at: string
      card_count: number
    }[]
    // Tile art: explicit deck image, else the commander's image.
    this.openReferenceIfPresent()
    const cmdStmt = this.invDb.prepare(
      "SELECT scryfall_id FROM deck_cards WHERE deck_id = ? AND category = 'commander' AND scryfall_id IS NOT NULL LIMIT 1"
    )
    const imgStmt = this.refDb?.prepare('SELECT image_uri FROM scryfall_cards WHERE scryfall_id = ?')
    return rows.map((r) => {
      let image = r.image_uri ?? null
      if (!image && imgStmt) {
        const cmd = cmdStmt.get(r.id) as { scryfall_id: string } | undefined
        if (cmd?.scryfall_id) {
          image = (imgStmt.get(cmd.scryfall_id) as { image_uri: string | null } | undefined)?.image_uri ?? null
        }
      }
      return {
        id: r.id,
        name: r.name,
        format: r.format as DeckFormat,
        cardCount: r.card_count,
        imageUri: image,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    })
  }

  /** Every printing of a card name (newest first) — feeds the change-art picker. */
  printingsForName(name: string): CardRef[] {
    this.openReferenceIfPresent()
    if (!this.refDb || !name.trim()) return []
    const rows = this.refDb
      .prepare(
        `SELECT * FROM scryfall_cards WHERE name = ? COLLATE NOCASE
         ORDER BY released_at DESC, collector_number`
      )
      .all(name.trim())
    return rows.map((r) => rowToCardRef(r as never, 'local'))
  }

  /**
   * Switch a deck line to a different printing (same card, new art). If that
   * printing already exists as another line in the same board, the two merge.
   */
  setDeckCardPrinting(rowId: number, scryfallId: string): void {
    const row = this.invDb
      .prepare('SELECT deck_id, category, quantity FROM deck_cards WHERE id = ?')
      .get(rowId) as { deck_id: number; category: string; quantity: number } | undefined
    if (!row) return
    const card = this.byScryfallId(scryfallId)
    const existing = this.invDb
      .prepare(
        'SELECT id FROM deck_cards WHERE deck_id = ? AND scryfall_id = ? AND category = ? AND id <> ?'
      )
      .get(row.deck_id, scryfallId, row.category, rowId) as { id: number } | undefined
    const doIt = this.invDb.transaction(() => {
      if (existing) {
        this.invDb
          .prepare('UPDATE deck_cards SET quantity = quantity + ? WHERE id = ?')
          .run(row.quantity, existing.id)
        this.invDb.prepare('DELETE FROM deck_cards WHERE id = ?').run(rowId)
      } else {
        this.invDb
          .prepare('UPDATE deck_cards SET scryfall_id = ?, name = COALESCE(?, name) WHERE id = ?')
          .run(scryfallId, card?.name ?? null, rowId)
      }
      this.touchDeck(row.deck_id)
    })
    doIt()
  }

  /** Pin a card's art as the deck's tile image (null clears it → commander art). */
  setDeckImage(deckId: number, imageUri: string | null): void {
    this.invDb
      .prepare("UPDATE decks SET image_uri = ?, updated_at = datetime('now') WHERE id = ?")
      .run(imageUri, deckId)
  }

  createDeck(name: string, format: DeckFormat = 'commander'): DeckSummary {
    const info = this.invDb
      .prepare('INSERT INTO decks (name, format) VALUES (?, ?)')
      .run(name.trim() || 'Untitled deck', format)
    return {
      id: Number(info.lastInsertRowid),
      name: name.trim() || 'Untitled deck',
      format,
      cardCount: 0,
      imageUri: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  renameDeck(id: number, name: string): void {
    this.invDb
      .prepare("UPDATE decks SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name.trim() || 'Untitled deck', id)
  }

  setDeckFormat(id: number, format: DeckFormat): void {
    this.invDb
      .prepare("UPDATE decks SET format = ?, updated_at = datetime('now') WHERE id = ?")
      .run(format, id)
  }

  deleteDeck(id: number): void {
    // ON DELETE CASCADE clears deck_cards.
    this.invDb.prepare('DELETE FROM decks WHERE id = ?').run(id)
  }

  private touchDeck(id: number): void {
    this.invDb.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(id)
  }

  getDeck(id: number): DeckDetail | null {
    const deck = this.invDb.prepare('SELECT * FROM decks WHERE id = ?').get(id) as
      | {
          id: number
          name: string
          format: string
          notes: string
          image_uri: string | null
          created_at: string
          updated_at: string
        }
      | undefined
    if (!deck) return null

    this.openReferenceIfPresent()
    const refStmt = this.refDb?.prepare(
      `SELECT set_code, collector_number, rarity, type_line, mana_cost, colors,
              image_uri, prices_eur, prices_eur_foil, prices_usd
       FROM scryfall_cards WHERE scryfall_id = ?`
    )
    // Owned is matched by card NAME (any printing/finish) — a shop owns "Sol
    // Ring" whichever printing it scanned, and deck lines resolve to the newest
    // printing on import, so a scryfall_id match would miss almost everything.
    const owned = new Map<string, number>()
    for (const o of this.invDb
      .prepare('SELECT name, SUM(quantity) AS qty FROM inventory GROUP BY name COLLATE NOCASE')
      .all() as { name: string; qty: number }[]) {
      owned.set(o.name.toLowerCase(), o.qty)
    }

    const rows = this.invDb
      .prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY id')
      .all(id) as {
      id: number
      scryfall_id: string | null
      name: string
      quantity: number
      category: string
    }[]

    const cards: DeckCard[] = rows.map((r) => {
      const ref = (r.scryfall_id ? refStmt?.get(r.scryfall_id) : undefined) as
        | {
            set_code: string
            collector_number: string
            rarity: string
            type_line: string
            mana_cost: string
            colors: string
            image_uri: string | null
            prices_eur: number | null
            prices_eur_foil: number | null
            prices_usd: number | null
          }
        | undefined
      return {
        rowId: r.id,
        scryfallId: r.scryfall_id,
        name: r.name,
        quantity: r.quantity,
        category: r.category,
        setCode: ref?.set_code ?? null,
        collectorNumber: ref?.collector_number ?? null,
        rarity: ref?.rarity ?? null,
        typeLine: ref?.type_line ?? null,
        manaCost: ref?.mana_cost ?? null,
        colors: ref ? (JSON.parse(ref.colors) as string[]) : null,
        imageUri: ref?.image_uri ?? null,
        priceEur: ref?.prices_eur ?? null,
        priceEurFoil: ref?.prices_eur_foil ?? null,
        priceUsd: ref?.prices_usd ?? null,
        owned: owned.get(r.name.toLowerCase()) ?? 0
      }
    })

    return {
      id: deck.id,
      name: deck.name,
      format: deck.format as DeckFormat,
      notes: deck.notes,
      imageUri: deck.image_uri ?? null,
      createdAt: deck.created_at,
      updatedAt: deck.updated_at,
      cards
    }
  }

  /** Add copies of a resolved printing to a deck, stacking an existing line. */
  addCardToDeck(deckId: number, scryfallId: string, quantity = 1, category = ''): void {
    if (quantity <= 0) return
    const card = this.byScryfallId(scryfallId)
    const name = card?.name ?? scryfallId
    const existing = this.invDb
      .prepare(
        'SELECT id FROM deck_cards WHERE deck_id = ? AND scryfall_id = ? AND category = ?'
      )
      .get(deckId, scryfallId, category) as { id: number } | undefined
    if (existing) {
      this.invDb
        .prepare('UPDATE deck_cards SET quantity = quantity + ? WHERE id = ?')
        .run(quantity, existing.id)
    } else {
      this.invDb
        .prepare(
          'INSERT INTO deck_cards (deck_id, scryfall_id, name, quantity, category) VALUES (?, ?, ?, ?, ?)'
        )
        .run(deckId, scryfallId, name, quantity, category)
    }
    this.touchDeck(deckId)
  }

  /** Set a deck line's quantity; a value of 0 or less deletes the line. */
  setDeckCardQuantity(rowId: number, quantity: number): void {
    const row = this.invDb
      .prepare('SELECT deck_id FROM deck_cards WHERE id = ?')
      .get(rowId) as { deck_id: number } | undefined
    if (!row) return
    if (quantity <= 0) {
      this.invDb.prepare('DELETE FROM deck_cards WHERE id = ?').run(rowId)
    } else {
      this.invDb.prepare('UPDATE deck_cards SET quantity = ? WHERE id = ?').run(quantity, rowId)
    }
    this.touchDeck(row.deck_id)
  }

  removeDeckCard(rowId: number): void {
    this.setDeckCardQuantity(rowId, 0)
  }

  /** Move a deck line to another board — '', 'commander', 'sideboard', 'maybe'. */
  setDeckCardCategory(rowId: number, category: string): void {
    const row = this.invDb
      .prepare('SELECT deck_id FROM deck_cards WHERE id = ?')
      .get(rowId) as { deck_id: number } | undefined
    if (!row) return
    this.invDb.prepare('UPDATE deck_cards SET category = ? WHERE id = ?').run(category, rowId)
    this.touchDeck(row.deck_id)
  }

  /**
   * A decklist of just the copies this deck is SHORT — `need − owned` per line,
   * over the main deck + commander. Feeds the "buy the missing singles" export.
   */
  deckMissingText(deckId: number): string {
    const deck = this.getDeck(deckId)
    if (!deck) return ''
    const lines: string[] = []
    for (const c of deck.cards) {
      if (c.category !== '' && c.category !== 'commander') continue
      const short = c.quantity - c.owned
      if (short > 0) lines.push(`${short} ${c.name}`)
    }
    return lines.join('\n')
  }

  /** Exact name first (newest printing), else a prefix match. Null if unknown. */
  private findPrintingByName(name: string): CardRef | null {
    this.openReferenceIfPresent()
    if (!this.refDb) return null
    const trimmed = name.trim()
    if (!trimmed) return null
    const exact = this.refDb
      .prepare(
        'SELECT * FROM scryfall_cards WHERE name = ? COLLATE NOCASE ORDER BY released_at DESC LIMIT 1'
      )
      .get(trimmed)
    if (exact) return rowToCardRef(exact as never, 'local')
    // Split cards / faces: "Fire // Ice" lists often carry only one face name.
    const prefix = this.refDb
      .prepare(
        `SELECT * FROM scryfall_cards WHERE name LIKE ? COLLATE NOCASE
         ORDER BY released_at DESC LIMIT 1`
      )
      .get(`${trimmed}%`)
    return prefix ? rowToCardRef(prefix as never, 'local') : null
  }

  /**
   * Import a pasted decklist. Understands "2 Sol Ring", "2x Island (FIN) 297",
   * the foil / etched markers, "SB:" prefixes, and section headers (Commander /
   * Sideboard / Maybeboard). Resolved lines stack on their printing; lines that
   * can't be resolved are kept as null-scryfall rows (still shown, still
   * counted) and their names returned in `missing`.
   */
  importDeckText(deckId: number, text: string): DeckImportResult {
    let added = 0
    const missing: string[] = []
    const insertUnresolved = this.invDb.prepare(
      'INSERT INTO deck_cards (deck_id, scryfall_id, name, quantity, category) VALUES (?, NULL, ?, ?, ?)'
    )

    const run = this.invDb.transaction(() => {
      let category = ''
      for (const rawLine of text.split(/\r?\n/)) {
        let line = rawLine.trim()
        if (!line || line.startsWith('//') || line.startsWith('#')) continue

        // Section headers (a bare word, no quantity). Strip a trailing colon.
        const header = line.toLowerCase().replace(/:+$/, '')
        if (!/^\d/.test(line) && !/^sb:/i.test(line)) {
          if (header === 'commander' || header === 'command zone') {
            category = 'commander'
            continue
          }
          if (header === 'sideboard' || header === 'maybeboard' || header === 'maybe') {
            category = header === 'sideboard' ? 'sideboard' : 'maybe'
            continue
          }
          if (header === 'deck' || header === 'mainboard' || header === 'main') {
            category = ''
            continue
          }
        }

        let lineCategory = category
        if (/^sb:/i.test(line)) {
          lineCategory = 'sideboard'
          line = line.replace(/^sb:\s*/i, '')
        }

        // quantity + rest
        const qm = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
        const quantity = qm ? Math.max(1, Number(qm[1])) : 1
        let rest = qm ? qm[2] : line

        // strip foil / etched markers and a trailing (SET) collector number
        rest = rest.replace(/\*[fFeE]\*/g, '').trim()
        let setCode: string | null = null
        let collectorNumber: string | null = null
        const setMatch = rest.match(/^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-★]+)?\s*$/)
        if (setMatch) {
          rest = setMatch[1].trim()
          setCode = setMatch[2]
          collectorNumber = setMatch[3] ?? null
        }
        const name = rest.trim()
        if (!name) continue

        let card: CardRef | null = null
        if (setCode && collectorNumber) card = this.lookup(setCode, collectorNumber)
        if (!card) card = this.findPrintingByName(name)

        if (card) {
          this.addCardToDeck(deckId, card.scryfallId, quantity, lineCategory)
          added += quantity
        } else {
          insertUnresolved.run(deckId, name, quantity, lineCategory)
          added += quantity
          missing.push(name)
        }
      }
      this.touchDeck(deckId)
    })
    run()
    return { deckId, added, missing }
  }

  /**
   * Insert normalised import entries (from a URL import). Each entry's
   * scryfall_id is tried first (exact printing → correct art), falling back to
   * a name match; unresolved names are kept as null-scryfall rows. Commander
   * entries land in the 'commander' board so they pin to the left column.
   */
  importDeckEntries(
    deckId: number,
    entries: { name: string; scryfallId: string | null; quantity: number; isCommander: boolean }[]
  ): DeckImportResult {
    let added = 0
    const missing: string[] = []
    const insertUnresolved = this.invDb.prepare(
      'INSERT INTO deck_cards (deck_id, scryfall_id, name, quantity, category) VALUES (?, NULL, ?, ?, ?)'
    )
    const run = this.invDb.transaction(() => {
      for (const e of entries) {
        const qty = Math.max(1, e.quantity)
        const category = e.isCommander ? 'commander' : ''
        let card = e.scryfallId ? this.byScryfallId(e.scryfallId) : null
        if (!card) card = this.findPrintingByName(e.name)
        if (card) {
          this.addCardToDeck(deckId, card.scryfallId, qty, category)
        } else {
          insertUnresolved.run(deckId, e.name, qty, category)
          missing.push(e.name)
        }
        added += qty
      }
      this.touchDeck(deckId)
    })
    run()
    return { deckId, added, missing }
  }

  close(): void {
    this.refDb?.close()
    this.refDb = null
    this.invDb.close()
  }
}

export interface ViewerCard {
  scryfallId: string
  name: string
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  typeLine: string
  imageUri: string | null
  /** Total owned copies across finishes (0 = not in inventory). */
  quantity: number
  /** Per-finish owned stacks (inventory mode only; empty in any-card mode). */
  stacks: { finish: Finish; quantity: number }[]
  priceUsd: number | null
  priceUsdFoil: number | null
  /** Cardmarket (EUR) prices from the Scryfall bulk data. */
  priceEur: number | null
  priceEurFoil: number | null
}
