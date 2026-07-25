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
}

export interface InventorySummary {
  items: InventoryItem[]
  /** sum of quantity over all stacks */
  totalCards: number
  distinctStacks: number
}

export interface LookupQuery {
  setCode: string
  collectorNumber: string
}
