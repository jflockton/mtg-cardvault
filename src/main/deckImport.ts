// Import a deck from a public URL. Archidekt has an open JSON API that returns
// the commander flag, real printings (scryfall uid) and quantities, so we get
// correct art + an auto-set commander for free. Moxfield blocks programmatic
// access (HTTP 403 on its API), so we detect it and steer the user to paste an
// export instead. Electron-free except for global fetch (Node 18+/Electron).

import type { DeckFormat } from '../shared/types'

export interface ImportEntry {
  name: string
  scryfallId: string | null
  quantity: number
  isCommander: boolean
}

export interface ImportedDeck {
  name: string
  format: DeckFormat
  entries: ImportEntry[]
  source: 'archidekt'
}

const UA = 'MTGCardVault/0.1 (github.com/jflockton/mtg-cardvault)'

/** Archidekt's numeric deckFormat → our format names. */
const ARCHIDEKT_FORMATS: Record<number, DeckFormat> = {
  1: 'standard',
  2: 'modern',
  3: 'commander',
  4: 'legacy',
  5: 'vintage',
  6: 'pauper',
  7: 'pioneer'
}

export function detectDeckSource(
  url: string
): { source: 'archidekt' | 'moxfield'; id: string } | null {
  const u = url.trim()
  const arch = u.match(/archidekt\.com\/(?:decks|api\/decks)\/(\d+)/i)
  if (arch) return { source: 'archidekt', id: arch[1] }
  const mox = u.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i)
  if (mox) return { source: 'moxfield', id: mox[1] }
  return null
}

interface ArchidektCardEntry {
  quantity?: number
  categories?: string[]
  card?: {
    uid?: string
    displayName?: string
    oracleCard?: { name?: string }
  }
}
interface ArchidektDeck {
  name?: string
  deckFormat?: number
  cards?: ArchidektCardEntry[]
}

async function fetchArchidekt(id: string): Promise<ImportedDeck> {
  const res = await fetch(`https://archidekt.com/api/decks/${id}/`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`Archidekt returned HTTP ${res.status}`)
  const d = (await res.json()) as ArchidektDeck

  const entries: ImportEntry[] = []
  for (const e of d.cards ?? []) {
    const cats = e.categories ?? []
    const name = e.card?.oracleCard?.name ?? e.card?.displayName
    if (!name) continue
    // Archidekt marks sideboard/maybeboard cards with those categories; skip the
    // maybeboard, keep the main deck + commander.
    if (cats.some((c) => c.toLowerCase() === 'maybeboard')) continue
    entries.push({
      name,
      scryfallId: e.card?.uid ?? null,
      quantity: e.quantity ?? 1,
      isCommander: cats.some((c) => c.toLowerCase() === 'commander')
    })
  }
  if (entries.length === 0) throw new Error('That Archidekt deck looks empty or private.')

  const hasCommander = entries.some((e) => e.isCommander)
  const format =
    (d.deckFormat != null && ARCHIDEKT_FORMATS[d.deckFormat]) ||
    (hasCommander ? 'commander' : 'casual')
  return { name: d.name?.trim() || `Archidekt deck ${id}`, format, entries, source: 'archidekt' }
}

/** Fetch + normalise a deck from a supported URL. Throws with a helpful message. */
export async function fetchDeckFromUrl(url: string): Promise<ImportedDeck> {
  const det = detectDeckSource(url)
  if (!det) {
    throw new Error(
      'Unrecognised deck URL. Archidekt links work directly; for Moxfield, use its Export and paste into “Import list”.'
    )
  }
  if (det.source === 'moxfield') {
    throw new Error(
      'Moxfield blocks direct import. On the deck page: ⋯ → Export → copy, then use “Import list” to paste it.'
    )
  }
  return fetchArchidekt(det.id)
}
