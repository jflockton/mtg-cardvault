import { contextBridge, ipcRenderer } from 'electron'
import type {
  CardRef,
  CornerScanResult,
  Finish,
  InventoryItem,
  InventorySummary,
  LookupQuery,
  PreconAddResult,
  PreconSummary,
  SetInfo,
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
  listInventory: (scope?: 'all' | 'session') => Promise<InventorySummary>
  /** All non-digital sets (code + name), newest first. */
  listSets: () => Promise<SetInfo[]>
  /** List all known preconstructed decks (MTGJSON). */
  preconList: () => Promise<PreconSummary[]>
  /** Name + card count for one precon (fetches its list). */
  preconInfo: (fileName: string) => Promise<{ name: string; totalCards: number }>
  /** Add every card of a precon to inventory. */
  preconAdd: (fileName: string) => Promise<PreconAddResult>
  /** Copy an export to the clipboard: plain list or CSV, all cards or this session's adds. */
  exportCollection: (
    format: 'list' | 'csv',
    scope: 'all' | 'session'
  ) => Promise<{ lines: number }>
  /** Move copies between finish stacks of the same printing. */
  moveFinish: (
    scryfallId: string,
    from: Finish,
    to: Finish,
    quantity?: number
  ) => Promise<InventoryItem | null>
  /** Copy the collection as "1 Card Name" lines to the clipboard. */
  /** OCR + resolve a corner crop; variants are the same crop in different polarities. */
  scanCorner: (imageVariants: string[]) => Promise<CornerScanResult>
  /** Name mode: OCR the title crop and match against card names. */
  scanTitle: (
    imageVariants: string[],
    pinnedSet?: string | null
  ) => Promise<CornerScanResult>
  /** Append a loop-decision note to the scan debug log. */
  note: (text: string) => void
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
  listInventory: (scope) => ipcRenderer.invoke('inv:list', { scope }),
  moveFinish: (scryfallId, from, to, quantity) =>
    ipcRenderer.invoke('inv:moveFinish', { scryfallId, from, to, quantity }),
  exportCollection: (format, scope) =>
    ipcRenderer.invoke('inv:exportCopy', { format, scope }),
  listSets: () => ipcRenderer.invoke('sets:list'),
  preconList: () => ipcRenderer.invoke('precon:list'),
  preconInfo: (fileName) => ipcRenderer.invoke('precon:info', fileName),
  preconAdd: (fileName) => ipcRenderer.invoke('precon:add', fileName),
  scanCorner: (imageVariants) => ipcRenderer.invoke('scan:corner', imageVariants),
  scanTitle: (imageVariants, pinnedSet) =>
    ipcRenderer.invoke('scan:title', { imageVariants, pinnedSet }),
  note: (text) => ipcRenderer.send('scan:note', text)
}

contextBridge.exposeInMainWorld('api', api)
