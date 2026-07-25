import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

import { DataStore } from './store'
import { buildReferenceDb, fetchCardLive } from './refdb'
import type { Finish, LookupQuery, RefProgress } from '../shared/types'

// Data lives in the OS app-data dir (survives reinstalls/updates, easy to
// back up). MTG_CARDVAULT_DATA_DIR overrides for development so the repo's
// ./data dir (built by `npm run build:refdb`) can be used directly.
function resolveDataDir(): string {
  if (process.env.MTG_CARDVAULT_DATA_DIR) return path.resolve(process.env.MTG_CARDVAULT_DATA_DIR)
  return path.join(app.getPath('userData'), 'data')
}

/**
 * First launch on a fresh machine: the installer ships a pre-built
 * reference.db in resources/ (read-only install dir). Copy it into the
 * writable app-data dir so the app works offline out of the box.
 */
function seedReferenceDbFromResources(dataDir: string): void {
  const target = path.join(dataDir, 'reference.db')
  if (fs.existsSync(target)) return
  const bundled = path.join(process.resourcesPath, 'reference.db')
  if (app.isPackaged && fs.existsSync(bundled)) {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.copyFileSync(bundled, target)
  }
}

let store: DataStore
let refreshing = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'MTG CardVault',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  ipcMain.handle('ref:status', () => store.refStatus())

  ipcMain.handle('ref:refresh', async (event) => {
    if (refreshing) return { ok: false, error: 'A refresh is already running' }
    refreshing = true
    const send = (p: RefProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send('ref:progress', p)
    }
    try {
      const workDir = path.join(store.dataDir, 'bulk')
      const count = await buildReferenceDb(store.referenceDbPath, workDir, send, (doSwap) =>
        store.withReferenceClosed(doSwap)
      )
      return { ok: true, cardCount: count }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      send({ phase: 'error', message })
      return { ok: false, error: message }
    } finally {
      refreshing = false
    }
  })

  ipcMain.handle('cards:lookup', async (_e, q: LookupQuery) => {
    const local = store.lookup(q.setCode, q.collectorNumber)
    if (local) return local
    // Genuine cache miss (e.g. set newer than the last bulk refresh) —
    // fall back to the live API and cache the hit for next time.
    try {
      const live = await fetchCardLive(q.setCode, q.collectorNumber)
      if (live) store.cacheCard(live)
      return live
    } catch {
      return null // offline or rate-limited — treat as not found, UI offers manual search
    }
  })

  ipcMain.handle('cards:search', (_e, query: string) => store.searchByName(query))

  ipcMain.handle('inv:add', (_e, args: { card: never; finish: Finish; quantity?: number }) =>
    store.addToInventory(args.card, args.finish, args.quantity ?? 1)
  )

  ipcMain.handle(
    'inv:remove',
    (_e, args: { scryfallId: string; finish: Finish; quantity?: number }) =>
      store.removeFromInventory(args.scryfallId, args.finish, args.quantity ?? 1)
  )

  ipcMain.handle('inv:list', () => store.listInventory())
}

app.whenReady().then(() => {
  const dataDir = resolveDataDir()
  seedReferenceDbFromResources(dataDir)
  store = new DataStore(dataDir)
  console.log(`[cardvault] data dir: ${dataDir}`)
  console.log(`[cardvault] reference: ${JSON.stringify(store.refStatus())}`)

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  store?.close()
})
