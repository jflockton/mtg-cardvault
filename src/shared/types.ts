// Shared between main, preload and renderer. Keep this file dependency-free.

export type Finish = 'nonfoil' | 'foil' | 'etched'

export const FINISHES: Finish[] = ['nonfoil', 'foil', 'etched']

/** A printing from the Scryfall reference table. */
export interface CardRef {
  scryfallId: string
  name: string
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  typeLine: string
  manaCost: string
  colors: string[]
  imageUri: string | null
  pricesUsd: number | null
  pricesUsdFoil: number | null
  finishes: Finish[]
  releasedAt: string | null
  /** 'local' = offline reference DB hit, 'live' = Scryfall API fallback */
  source: 'local' | 'live'
}

export interface RefStatus {
  ready: boolean
  cardCount: number
  updatedAt: string | null
}

export interface RefProgress {
  phase: 'listing' | 'download' | 'import' | 'finalize' | 'done' | 'error'
  receivedBytes?: number
  totalBytes?: number
  imported?: number
  message?: string
}

export interface InventoryItem {
  id: number
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  rarity: string
  typeLine: string
  manaCost: string
  colors: string[]
  finish: Finish
  quantity: number
  imageUri: string | null
  addedAt: string
  updatedAt: string
  /** Market price (USD) recorded by the most recent scan of this stack. */
  lastPrice: number | null
  /** UTC timestamp of the most recent scan of this stack. */
  lastScannedAt: string | null
}

export interface InventorySummary {
  items: InventoryItem[]
  /** sum of quantity over all stacks */
  totalCards: number
  distinctStacks: number
  /** total market value (USD) of every stack at current reference prices */
  totalValue: number
}

export interface LookupQuery {
  setCode: string
  collectorNumber: string
}

/** Outcome of resolving an OCR'd corner against the reference DB. */
export interface ScanResolution {
  kind: 'exact' | 'candidates' | 'none'
  card?: CardRef
  candidates?: CardRef[]
}

/** Full result of a corner scan, returned to the renderer. */
export interface CornerScanResult {
  resolution: ScanResolution
  /** What the parser extracted (nulls where unreadable). */
  parsed: {
    setCode: string | null
    number: string | null
    total: number | null
    year: number | null
    raw: string
  }
  confidence: number
  /** Word-level confidence of the collector-number token (null if unknown). */
  numberConf: number | null
  /** Word-level confidence of the set-code token (null if unknown). */
  setConf: number | null
  ms: number
}
