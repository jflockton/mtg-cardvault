import { app, BrowserWindow, clipboard, ipcMain, session, shell, systemPreferences } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

import { DataStore } from './store'
import { buildReferenceDb, fetchCardLive, fetchSetsList } from './refdb'
import { fetchPreconList, fetchPrecon } from './precon'
import { scanCorner, scanTitle, terminateOcr } from './ocr'
import type { CornerScanResult, Finish, LookupQuery, RefProgress } from '../shared/types'

/** Tesseract traineddata: repo-local in dev, resources/tessdata when packaged. */
function resolveTessdataDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tessdata')
    : path.join(app.getAppPath(), 'resources', 'tessdata')
}

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

/**
 * One NDJSON line per scan decision → <dataDir>/scan-debug.log. Cheap,
 * append-only, and exactly what's needed to diagnose "why didn't it lock".
 */
function logScan(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(
      path.join(store.dataDir, 'scan-debug.log'),
      JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n'
    )
  } catch {
    // never let diagnostics break scanning
  }
}

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

  // Copy the "1 Card Name" list to the clipboard from the main process —
  // renderer clipboard permissions are locked down.
  ipcMain.handle('inv:exportCopy', () => {
    const text = store.exportList()
    clipboard.writeText(text)
    return { lines: text ? text.split('\n').length : 0 }
  })

  ipcMain.handle(
    'scan:title',
    async (
      _e,
      args: { imageVariants: string[]; pinnedSet?: string | null }
    ): Promise<CornerScanResult> => {
      const scan = await scanTitle(args.imageVariants, resolveTessdataDir())
      const match = store.matchName(scan.text, args.pinnedSet)
      // Exact name matches are trustworthy regardless of raw OCR confidence;
      // fuzzy ones stage (the sustained-agreement path still commits them).
      const confidence = match.quality === 'exact' ? 90 : match.quality === 'fuzzy' ? 55 : 0
      logScan({
        mode: 'name',
        pin: args.pinnedSet ?? null,
        raw: scan.text.slice(0, 160),
        cleaned: match.cleaned,
        quality: match.quality,
        ocrConf: Math.round(scan.confidence),
        result: match.resolution.kind,
        card: match.resolution.card
          ? `${match.resolution.card.name} [${match.resolution.card.setCode} #${match.resolution.card.collectorNumber}]`
          : null,
        candidates: match.resolution.candidates?.length ?? 0,
        ms: scan.ms
      })
      return {
        resolution: match.resolution,
        parsed: {
          setCode: null,
          number: null,
          total: null,
          year: null,
          token: false,
          raw: scan.text,
          nameRead: match.cleaned
        },
        confidence,
        numberConf: confidence,
        setConf: null,
        ms: scan.ms
      }
    }
  )

  ipcMain.handle('precon:list', () => fetchPreconList())

  ipcMain.handle('precon:info', async (_e, fileName: string) => {
    const deck = await fetchPrecon(fileName)
    return { name: deck.name, totalCards: deck.totalCards }
  })

  ipcMain.handle('precon:add', async (_e, fileName: string) => {
    const deck = await fetchPrecon(fileName)
    let added = 0
    const missing: string[] = []
    for (const pc of deck.cards) {
      let card = pc.scryfallId ? store.byScryfallId(pc.scryfallId) : null
      if (!card && pc.setCode && pc.number) card = store.lookup(pc.setCode, pc.number)
      if (!card) {
        missing.push(`${pc.count}× ${pc.setCode.toUpperCase()} #${pc.number}`)
        continue
      }
      const finish = pc.foil
        ? card.finishes.includes('foil')
          ? ('foil' as const)
          : (card.finishes[0] ?? ('nonfoil' as const))
        : card.finishes.includes('nonfoil')
          ? ('nonfoil' as const)
          : (card.finishes[0] ?? ('nonfoil' as const))
      store.addToInventory(card, finish, pc.count)
      added += pc.count
    }
    return { deckName: deck.name, added, missing }
  })

  ipcMain.handle(
    'inv:moveFinish',
    (_e, args: { scryfallId: string; from: Finish; to: Finish; quantity?: number }) =>
      store.moveFinish(args.scryfallId, args.from, args.to, args.quantity ?? 1)
  )

  ipcMain.handle('scan:corner', async (_e, imageVariants: string[]): Promise<CornerScanResult> => {
    const scan = await scanCorner(imageVariants, resolveTessdataDir())
    let resolution = store.resolveCorner(scan.parse)
    // Modern card whose set is newer than the reference DB: try live.
    if (resolution.kind === 'none' && scan.parse.setCode && scan.parse.number) {
      try {
        const live = await fetchCardLive(scan.parse.setCode, scan.parse.number)
        if (live) {
          store.cacheCard(live)
          resolution = { kind: 'exact', card: live }
        }
      } catch {
        // offline/rate-limited — leave as none
      }
    }
    logScan({
      mode: 'corner',
      raw: scan.parse.raw.slice(0, 160),
      set: scan.parse.setCode,
      num: scan.parse.number,
      total: scan.parse.total,
      year: scan.parse.year,
      token: scan.parse.token,
      conf: Math.round(scan.confidence),
      numConf: scan.numberConf === null ? null : Math.round(scan.numberConf),
      result: resolution.kind,
      card: resolution.card ? `${resolution.card.name} [${resolution.card.setCode} #${resolution.card.collectorNumber}]` : null,
      candidates: resolution.candidates?.length ?? 0,
      ms: scan.ms
    })
    return {
      resolution,
      parsed: scan.parse,
      confidence: scan.confidence,
      numberConf: scan.numberConf,
      setConf: scan.setConf,
      ms: scan.ms
    }
  })
}

app.whenReady().then(() => {
  // Webcam access: allow media permission requests from our own renderer,
  // and trigger the one-time macOS system prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('camera').catch(() => {})
  }

  const dataDir = resolveDataDir()
  seedReferenceDbFromResources(dataDir)
  store = new DataStore(dataDir)
  console.log(`[cardvault] data dir: ${dataDir}`)
  console.log(`[cardvault] reference: ${JSON.stringify(store.refStatus())}`)

  // Reference DBs built before set metadata existed: backfill in the
  // background (one small API call). Fresh imports include it already.
  if (store.refStatus().ready && !store.hasSetMetadata()) {
    fetchSetsList()
      .then((rows) => {
        store.upsertSets(rows)
        console.log(`[cardvault] backfilled ${rows.length} sets`)
      })
      .catch((err) => console.warn('[cardvault] sets backfill failed:', err))
  }

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
  void terminateOcr()
  store?.close()
})
