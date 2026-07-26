// Preconstructed-deck lists via MTGJSON (Scryfall has no deck contents).
// Electron-free. Deck list + deck files are fetched on demand and memoised.

import { USER_AGENT } from './refdb'

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
const DECK_LIST_URL = 'https://mtgjson.com/api/v5/DeckList.json'
const DECK_URL = (fileName: string): string =>
  `https://mtgjson.com/api/v5/decks/${encodeURIComponent(fileName)}.json`

export interface PreconSummary {
  name: string
  code: string
  fileName: string
  releaseDate: string | null
  type: string
}

export interface PreconCard {
  scryfallId: string | null
  setCode: string
  number: string
  count: number
  foil: boolean
}

export interface PreconDeck {
  name: string
  cards: PreconCard[]
  totalCards: number
}

let listCache: { at: number; decks: PreconSummary[] } | null = null
const deckCache = new Map<string, PreconDeck>()
const DAY_MS = 24 * 60 * 60 * 1000

export async function fetchPreconList(): Promise<PreconSummary[]> {
  if (listCache && Date.now() - listCache.at < DAY_MS) return listCache.decks
  const res = await fetch(DECK_LIST_URL, { headers: HEADERS })
  if (!res.ok) throw new Error(`MTGJSON deck list failed: HTTP ${res.status}`)
  const json = (await res.json()) as {
    data: { name: string; code: string; fileName: string; releaseDate?: string; type?: string }[]
  }
  const decks = json.data
    .map((d) => ({
      name: d.name,
      code: d.code,
      fileName: d.fileName,
      releaseDate: d.releaseDate ?? null,
      type: d.type ?? ''
    }))
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
  listCache = { at: Date.now(), decks }
  return decks
}

interface MtgjsonDeckCard {
  count?: number
  isFoil?: boolean
  setCode?: string
  number?: string | number
  identifiers?: { scryfallId?: string }
}

export async function fetchPrecon(fileName: string): Promise<PreconDeck> {
  const cached = deckCache.get(fileName)
  if (cached) return cached
  const res = await fetch(DECK_URL(fileName), { headers: HEADERS })
  if (!res.ok) throw new Error(`MTGJSON deck fetch failed: HTTP ${res.status}`)
  const json = (await res.json()) as {
    data: {
      name: string
      commander?: MtgjsonDeckCard[]
      mainBoard?: MtgjsonDeckCard[]
      sideBoard?: MtgjsonDeckCard[]
    }
  }
  const boards = [
    ...(json.data.commander ?? []),
    ...(json.data.mainBoard ?? []),
    ...(json.data.sideBoard ?? [])
  ]
  const cards: PreconCard[] = boards.map((c) => ({
    scryfallId: c.identifiers?.scryfallId ?? null,
    setCode: (c.setCode ?? '').toLowerCase(),
    number: String(c.number ?? ''),
    count: c.count ?? 1,
    foil: Boolean(c.isFoil)
  }))
  const deck: PreconDeck = {
    name: json.data.name,
    cards,
    totalCards: cards.reduce((sum, c) => sum + c.count, 0)
  }
  deckCache.set(fileName, deck)
  return deck
}
