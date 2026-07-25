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
import type { CardRef, Finish, InventoryItem, InventorySummary, RefStatus } from '../shared/types'

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
`

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
}

function rowToItem(r: InvRow): InventoryItem {
  return {
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

  /** Upsert: same (scryfall_id, finish) stack increments quantity. */
  addToInventory(card: CardRef, finish: Finish, quantity = 1): InventoryItem {
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
    const row = this.invDb
      .prepare('SELECT * FROM inventory WHERE scryfall_id = ? AND finish = ?')
      .get(card.scryfallId, finish) as InvRow
    return rowToItem(row)
  }

  /** Decrement a stack; the row is deleted when it reaches zero. */
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
    if (newQty <= 0) {
      this.invDb.prepare('DELETE FROM inventory WHERE id = ?').run(row.id)
      return rowToItem({ ...row, quantity: 0 })
    }
    this.invDb
      .prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newQty, row.id)
    return rowToItem({ ...row, quantity: newQty })
  }

  listInventory(limit = 500): InventorySummary {
    const items = (
      this.invDb
        .prepare('SELECT * FROM inventory ORDER BY updated_at DESC LIMIT ?')
        .all(limit) as InvRow[]
    ).map(rowToItem)
    const totals = this.invDb
      .prepare('SELECT COALESCE(SUM(quantity), 0) AS total, COUNT(*) AS stacks FROM inventory')
      .get() as { total: number; stacks: number }
    return { items, totalCards: totals.total, distinctStacks: totals.stacks }
  }

  close(): void {
    this.refDb?.close()
    this.refDb = null
    this.invDb.close()
  }
}
