import { contextBridge, ipcRenderer } from 'electron'
import type {
  CardRef,
  CornerScanResult,
  Finish,
  InventoryItem,
  InventorySummary,
  LookupQuery,
  RefProgress,
  RefStatus
} from '../shared/types'

export interface CardVaultApi {
  refStatus: () => Promise<RefStatus>
  refreshReference: () => Promise<{ ok: boolean; cardCount?: number; error?: string }>
  onRefProgress: (cb: (p: RefProgress) => void) => () => void
  lookupCard: (q: LookupQuery) => Promise<CardRef | null>
  searchCards: (query: string) => Promise<CardRef[]>
  addCard: (card: CardRef, finish: Finish, quantity?: number) => Promise<InventoryItem>
  removeCard: (
    scryfallId: string,
    finish: Finish,
    quantity?: number
  ) => Promise<InventoryItem | null>
  listInventory: () => Promise<InventorySummary>
  /** Move copies between finish stacks of the same printing. */
  moveFinish: (
    scryfallId: string,
    from: Finish,
    to: Finish,
    quantity?: number
  ) => Promise<InventoryItem | null>
  /** OCR + resolve a corner crop; variants are the same crop in different polarities. */
  scanCorner: (imageVariants: string[]) => Promise<CornerScanResult>
}

const api: CardVaultApi = {
  refStatus: () => ipcRenderer.invoke('ref:status'),
  refreshReference: () => ipcRenderer.invoke('ref:refresh'),
  onRefProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: RefProgress): void => cb(p)
    ipcRenderer.on('ref:progress', listener)
    return () => ipcRenderer.removeListener('ref:progress', listener)
  },
  lookupCard: (q) => ipcRenderer.invoke('cards:lookup', q),
  searchCards: (query) => ipcRenderer.invoke('cards:search', query),
  addCard: (card, finish, quantity) => ipcRenderer.invoke('inv:add', { card, finish, quantity }),
  removeCard: (scryfallId, finish, quantity) =>
    ipcRenderer.invoke('inv:remove', { scryfallId, finish, quantity }),
  listInventory: () => ipcRenderer.invoke('inv:list'),
  moveFinish: (scryfallId, from, to, quantity) =>
    ipcRenderer.invoke('inv:moveFinish', { scryfallId, from, to, quantity }),
  scanCorner: (imageVariants) => ipcRenderer.invoke('scan:corner', imageVariants)
}

contextBridge.exposeInMainWorld('api', api)
