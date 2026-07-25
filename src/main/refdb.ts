// Scryfall reference DB: bulk download + streaming import.
// This module is deliberately Electron-free so it can also run under plain
// Node (scripts/build-reference-db.ts builds the DB that gets bundled into
// the installers).

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import Database from 'better-sqlite3'
import streamArray from 'stream-json/streamers/stream-array.js'

import type { CardRef, Finish, RefProgress } from '../shared/types'

export const USER_AGENT = 'MTGCardVault/0.1 (github.com/jflockton/mtg-cardvault)'
const SCRYFALL_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
const BULK_DATA_URL = 'https://api.scryfall.com/bulk-data'

export const REF_SCHEMA = `
CREATE TABLE IF NOT EXISTS scryfall_sets (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  released_at  TEXT,
  card_count   INTEGER,
  printed_size INTEGER,
  set_type     TEXT,
  digital      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scryfall_cards (
  scryfall_id      TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  set_name         TEXT NOT NULL DEFAULT '',
  collector_number TEXT NOT NULL,
  rarity           TEXT NOT NULL DEFAULT '',
  type_line        TEXT NOT NULL DEFAULT '',
  mana_cost        TEXT NOT NULL DEFAULT '',
  colors           TEXT NOT NULL DEFAULT '[]',
  image_uri        TEXT,
  prices_usd       REAL,
  prices_usd_foil  REAL,
  finishes         TEXT NOT NULL DEFAULT '["nonfoil"]',
  released_at      TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export const REF_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_cards_set_cn ON scryfall_cards (set_code, collector_number);
CREATE INDEX IF NOT EXISTS idx_cards_name ON scryfall_cards (name COLLATE NOCASE);
`

/** Normalise a set code for lookup: Scryfall stores lowercase codes. */
export function normalizeSetCode(setCode: string): string {
  return setCode.trim().toLowerCase()
}

/**
 * Normalise a collector number for lookup. OCR reads things like "0123/280";
 * Scryfall stores "123" (no leading zeros, no "/total", but suffixes like
 * "123a" or "GR8" exist and are preserved).
 */
export function normalizeCollectorNumber(cn: string): string {
  let out = cn.trim().split('/')[0].trim()
  out = out.replace(/^0+(?=[0-9])/, '')
  return out.toLowerCase()
}

interface ScryfallCardJson {
  id: string
  name: string
  set: string
  set_name?: string
  collector_number: string
  rarity?: string
  type_line?: string
  mana_cost?: string
  colors?: string[]
  color_identity?: string[]
  image_uris?: { normal?: string }
  card_faces?: {
    mana_cost?: string
    colors?: string[]
    image_uris?: { normal?: string }
  }[]
  prices?: { usd?: string | null; usd_foil?: string | null }
  finishes?: string[]
  games?: string[]
  released_at?: string
}

interface RefRow {
  scryfall_id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  type_line: string
  mana_cost: string
  colors: string
  image_uri: string | null
  prices_usd: number | null
  prices_usd_foil: number | null
  finishes: string
  released_at: string | null
}

function toNum(v: string | null | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map a raw Scryfall card object to a reference row. Returns null for cards we skip. */
export function mapCard(c: ScryfallCardJson): RefRow | null {
  // Skip digital-only printings (Arena/MTGO) — the shop scans paper cards.
  if (Array.isArray(c.games) && c.games.length > 0 && !c.games.includes('paper')) return null

  const face = Array.isArray(c.card_faces) && c.card_faces.length > 0 ? c.card_faces[0] : null
  const imageUri = c.image_uris?.normal ?? face?.image_uris?.normal ?? null
  const manaCost =
    c.mana_cost ??
    (c.card_faces ? c.card_faces.map((f) => f.mana_cost).filter(Boolean).join(' // ') : '')
  const colors = c.colors ?? face?.colors ?? c.color_identity ?? []

  return {
    scryfall_id: c.id,
    name: c.name,
    set_code: c.set,
    set_name: c.set_name ?? '',
    collector_number: normalizeCollectorNumber(c.collector_number),
    rarity: c.rarity ?? '',
    type_line: c.type_line ?? '',
    mana_cost: manaCost ?? '',
    colors: JSON.stringify(colors),
    image_uri: imageUri,
    prices_usd: toNum(c.prices?.usd),
    prices_usd_foil: toNum(c.prices?.usd_foil),
    finishes: JSON.stringify(c.finishes ?? ['nonfoil']),
    released_at: c.released_at ?? null
  }
}

export function rowToCardRef(row: RefRow, source: 'local' | 'live'): CardRef {
  return {
    scryfallId: row.scryfall_id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    typeLine: row.type_line,
    manaCost: row.mana_cost,
    colors: JSON.parse(row.colors),
    imageUri: row.image_uri,
    pricesUsd: row.prices_usd,
    pricesUsdFoil: row.prices_usd_foil,
    finishes: JSON.parse(row.finishes) as Finish[],
    releasedAt: row.released_at,
    source
  }
}

export interface ScryfallSetRow {
  code: string
  name: string
  released_at: string | null
  card_count: number | null
  printed_size: number | null
  set_type: string | null
  digital: number
}

/**
 * Fetch the full set list (~900 rows, one small call). printed_size is the
 * total printed on cards ("13/150" → 150) — the key to identifying old
 * frames that carry no set code.
 */
export async function fetchSetsList(): Promise<ScryfallSetRow[]> {
  const rows: ScryfallSetRow[] = []
  let url: string | null = 'https://api.scryfall.com/sets'
  while (url) {
    const res = await fetch(url, { headers: SCRYFALL_HEADERS })
    if (!res.ok) throw new Error(`Scryfall sets listing failed: HTTP ${res.status}`)
    const page = (await res.json()) as {
      data: {
        code: string
        name: string
        released_at?: string
        card_count?: number
        printed_size?: number
        set_type?: string
        digital?: boolean
      }[]
      has_more?: boolean
      next_page?: string
    }
    for (const s of page.data) {
      rows.push({
        code: s.code,
        name: s.name,
        released_at: s.released_at ?? null,
        card_count: s.card_count ?? null,
        printed_size: s.printed_size ?? null,
        set_type: s.set_type ?? null,
        digital: s.digital ? 1 : 0
      })
    }
    url = page.has_more && page.next_page ? page.next_page : null
  }
  return rows
}

/** Fetch the bulk-data listing and return the default_cards download URI + size. */
export async function getDefaultCardsBulkInfo(): Promise<{
  downloadUri: string
  size: number
  updatedAt: string
}> {
  const res = await fetch(BULK_DATA_URL, { headers: SCRYFALL_HEADERS })
  if (!res.ok) throw new Error(`Scryfall bulk-data listing failed: HTTP ${res.status}`)
  const listing = (await res.json()) as {
    data: { type: string; download_uri: string; size: number; updated_at: string }[]
  }
  const entry = listing.data.find((d) => d.type === 'default_cards')
  if (!entry) throw new Error('default_cards entry not found in Scryfall bulk-data listing')
  return { downloadUri: entry.download_uri, size: entry.size, updatedAt: entry.updated_at }
}

/** Stream a URL to a file on disk without holding it in memory. */
export async function downloadToFile(
  url: string,
  destPath: string,
  totalBytes: number,
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const res = await fetch(url, { headers: SCRYFALL_HEADERS })
  if (!res.ok || !res.body) throw new Error(`Bulk download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || totalBytes
  fs.mkdirSync(path.dirname(destPath), { recursive: true })

  let received = 0
  let lastReport = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received - lastReport > 4 * 1024 * 1024) {
        lastReport = received
        onProgress?.(received, total)
      }
      controller.enqueue(chunk)
    }
  })

  await pipeline(
    Readable.fromWeb(res.body.pipeThrough(counter) as import('node:stream/web').ReadableStream),
    fs.createWriteStream(destPath)
  )
  onProgress?.(received, total)
}

/** Stream-parse the bulk JSON array file into a fresh SQLite DB at dbPath. */
export async function importBulkFile(
  bulkJsonPath: string,
  dbPath: string,
  bulkUpdatedAt: string,
  onProgress?: (imported: number) => void
): Promise<number> {
  fs.rmSync(dbPath, { force: true })
  const db = new Database(dbPath)
  // Fresh throwaway build — crash safety doesn't matter, speed does.
  db.pragma('journal_mode = OFF')
  db.pragma('synchronous = OFF')
  db.exec(REF_SCHEMA)

  const insert = db.prepare(`
    INSERT OR REPLACE INTO scryfall_cards
      (scryfall_id, name, set_code, set_name, collector_number, rarity, type_line,
       mana_cost, colors, image_uri, prices_usd, prices_usd_foil, finishes, released_at)
    VALUES
      (@scryfall_id, @name, @set_code, @set_name, @collector_number, @rarity, @type_line,
       @mana_cost, @colors, @image_uri, @prices_usd, @prices_usd_foil, @finishes, @released_at)
  `)
  const insertBatch = db.transaction((rows: RefRow[]) => {
    for (const row of rows) insert.run(row)
  })

  let imported = 0
  let batch: RefRow[] = []
  const BATCH_SIZE = 2000

  try {
    const jsonStream = streamArray.withParserAsStream()
    const source = fs.createReadStream(bulkJsonPath)
    source.pipe(jsonStream)

    await new Promise<void>((resolve, reject) => {
      source.on('error', reject)
      jsonStream.on('data', ({ value }: { value: ScryfallCardJson }) => {
        const row = mapCard(value)
        if (!row) return
        batch.push(row)
        if (batch.length >= BATCH_SIZE) {
          insertBatch(batch)
          imported += batch.length
          batch = []
          onProgress?.(imported)
        }
      })
      jsonStream.on('end', () => resolve())
      jsonStream.on('error', reject)
    })

    if (batch.length > 0) {
      insertBatch(batch)
      imported += batch.length
    }

    db.exec(REF_INDEXES)
    const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    setMeta.run('updated_at', bulkUpdatedAt)
    setMeta.run('card_count', String(imported))
    setMeta.run('imported_at', new Date().toISOString())
    onProgress?.(imported)
  } finally {
    db.close()
  }
  return imported
}

/**
 * Full refresh: download the default_cards bulk file and rebuild the reference
 * DB at targetDbPath. Builds to a .tmp file and renames at the end, so an
 * existing DB keeps working until the swap. Caller must ensure no open handle
 * on targetDbPath at swap time (see DataStore.withReferenceClosed).
 */
export async function buildReferenceDb(
  targetDbPath: string,
  workDir: string,
  onProgress?: (p: RefProgress) => void,
  swap?: (doSwap: () => void) => void
): Promise<number> {
  onProgress?.({ phase: 'listing' })
  const info = await getDefaultCardsBulkInfo()

  const bulkPath = path.join(workDir, 'default_cards.json')
  onProgress?.({ phase: 'download', receivedBytes: 0, totalBytes: info.size })
  await downloadToFile(info.downloadUri, bulkPath, info.size, (received, total) =>
    onProgress?.({ phase: 'download', receivedBytes: received, totalBytes: total })
  )

  const tmpDbPath = targetDbPath + '.tmp'
  onProgress?.({ phase: 'import', imported: 0 })
  const count = await importBulkFile(bulkPath, tmpDbPath, info.updatedAt, (imported) =>
    onProgress?.({ phase: 'import', imported })
  )

  // Set metadata (printed_size etc.) — small, but powers old-frame resolution.
  try {
    upsertSetsIntoDb(tmpDbPath, await fetchSetsList())
  } catch (err) {
    console.warn('sets listing failed (non-fatal):', err)
  }

  onProgress?.({ phase: 'finalize' })
  const doSwap = () => {
    fs.rmSync(targetDbPath, { force: true })
    fs.renameSync(tmpDbPath, targetDbPath)
  }
  if (swap) swap(doSwap)
  else doSwap()

  fs.rmSync(bulkPath, { force: true })
  onProgress?.({ phase: 'done', imported: count })
  return count
}

export function upsertSetsIntoDb(dbPath: string, rows: ScryfallSetRow[]): void {
  const db = new Database(dbPath)
  try {
    db.exec(REF_SCHEMA)
    const insert = db.prepare(`
      INSERT OR REPLACE INTO scryfall_sets
        (code, name, released_at, card_count, printed_size, set_type, digital)
      VALUES (@code, @name, @released_at, @card_count, @printed_size, @set_type, @digital)
    `)
    db.transaction((all: ScryfallSetRow[]) => {
      for (const r of all) insert.run(r)
    })(rows)
  } finally {
    db.close()
  }
}

/**
 * Live-API fallback for genuine cache misses (e.g. a set newer than the last
 * refresh). Rare by design — every hit is one card, well under Scryfall's
 * ~10 req/s allowance for this endpoint.
 */
export async function fetchCardLive(
  setCode: string,
  collectorNumber: string
): Promise<CardRef | null> {
  const set = encodeURIComponent(normalizeSetCode(setCode))
  const cn = encodeURIComponent(normalizeCollectorNumber(collectorNumber))
  const res = await fetch(`https://api.scryfall.com/cards/${set}/${cn}`, {
    headers: SCRYFALL_HEADERS
  })
  if (res.status === 404) return null
  if (res.status === 429) throw new Error('Scryfall rate limit hit (429) — wait 30s and retry')
  if (!res.ok) throw new Error(`Scryfall lookup failed: HTTP ${res.status}`)
  const row = mapCard((await res.json()) as ScryfallCardJson)
  return row ? rowToCardRef(row, 'live') : null
}
