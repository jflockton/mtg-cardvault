import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, systemPreferences } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

import { DataStore } from './store'
import {
  clearInventoryDir,
  defaultCloudInventoryDir,
  findConflictedCopies,
  loadInventoryDir,
  saveInventoryDir
} from './dataLocation'
import { buildReferenceDb, fetchCardLive, fetchSetsList } from './refdb'
import { fetchPreconList, fetchPrecon } from './precon'
import { fetchDeckFromUrl } from './deckImport'
import { scanCorner, scanTitle, terminateOcr } from './ocr'
import { openInventoryViewer, closeInventoryViewer, gbpRate } from './viewer'
import type { CornerScanResult, DeckFormat, Finish, LookupQuery, RefProgress } from '../shared/types'

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
  const bundled = path.join(process.resourcesPath, 'reference.db')
  if (!app.isPackaged || !fs.existsSync(bundled)) return
  if (fs.existsSync(target)) {
    // Keep the existing copy unless its schema predates this app version
    // (e.g. missing the Cardmarket EUR price columns) — then re-seed.
    try {
      const db = new Database(target, { readonly: true })
      const cols = db.prepare('PRAGMA table_info(scryfall_cards)').all() as { name: string }[]
      db.close()
      if (cols.some((c) => c.name === 'prices_eur')) return
    } catch {
      // unreadable/corrupt → fall through and re-seed
    }
  }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.copyFileSync(bundled, target)
}

let store: DataStore
let mainWindow: BrowserWindow | null = null
let viewerWindow: BrowserWindow | null = null
let refreshing = false
/** UTC start of this app run — the boundary for "scanned this session". */
const launchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Scope boundary: session = this app run; today = local midnight (as UTC). */
function sinceFor(scope?: 'all' | 'session' | 'today'): string {
  if (scope === 'today') {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    return midnight.toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  return launchedAt
}

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

/** The Spidey app icon — repo build/ in dev, resources/ when packaged. */
function resolveAppIcon(): string | undefined {
  const dev = path.join(app.getAppPath(), 'build', 'icon.png')
  if (fs.existsSync(dev)) return dev
  const packaged = path.join(process.resourcesPath, 'icon.png')
  if (fs.existsSync(packaged)) return packaged
  return undefined
}

function createWindow(): BrowserWindow {
  const icon = resolveAppIcon()
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'MTG CardVault',
    ...(icon ? { icon } : {}),
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
  mainWindow = win
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

  ipcMain.handle('sets:list', () => store.listSets())

  ipcMain.handle('inv:add', (_e, args: { card: never; finish: Finish; quantity?: number }) =>
    store.addToInventory(args.card, args.finish, args.quantity ?? 1)
  )

  ipcMain.handle(
    'inv:remove',
    (_e, args: { scryfallId: string; finish: Finish; quantity?: number }) =>
      store.removeFromInventory(args.scryfallId, args.finish, args.quantity ?? 1)
  )

  // Date bounds (YYYY-MM-DD, from the collection view) become a 'range'
  // scope over the scan log; either side may be open.
  const rangeBounds = (from?: string, to?: string): [string, string] | null =>
    from || to
      ? [
          from ? `${from}T00:00:00Z` : '0000-01-01T00:00:00Z',
          to ? `${to}T23:59:59Z` : '9999-12-31T23:59:59Z'
        ]
      : null

  ipcMain.handle(
    'inv:list',
    (_e, args?: { scope?: 'all' | 'session' | 'today'; from?: string; to?: string }) => {
      const range = rangeBounds(args?.from, args?.to)
      if (range) return store.listInventory(500, 'range', range[0], range[1])
      return store.listInventory(500, args?.scope ?? 'all', sinceFor(args?.scope))
    }
  )

  // Copy the export to the clipboard from the main process — renderer
  // clipboard permissions are locked down. Scope 'session' = adds since this
  // app launch (undone adds retract from the scan log, so it stays honest).
  const exportTextFor = (format: 'csv' | 'list', from?: string, to?: string): string => {
    const range = rangeBounds(from, to)
    return range
      ? store.exportText(format, 'range', range[0], range[1])
      : store.exportText(format, 'all')
  }

  ipcMain.handle(
    'inv:exportCopy',
    (_e, args?: { format?: 'csv' | 'list'; from?: string; to?: string }) => {
      const text = exportTextFor(args?.format ?? 'list', args?.from, args?.to)
      clipboard.writeText(text)
      return { lines: text ? text.split('\n').length : 0 }
    }
  )

  // File export: same content, saved wherever the user picks.
  ipcMain.handle(
    'inv:exportFile',
    async (_e, args?: { format?: 'csv' | 'list'; from?: string; to?: string }) => {
      const format = args?.format ?? 'list'
      const text = exportTextFor(format, args?.from, args?.to)
      const stamp = new Date().toISOString().slice(0, 10)
      const ext = format === 'csv' ? 'csv' : 'txt'
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export collection',
        defaultPath: path.join(
          app.getPath('downloads'),
          `cardvault-${format === 'csv' ? 'export' : 'decklist'}-${stamp}.${ext}`
        )
      })
      if (canceled || !filePath) return { canceled: true }
      fs.writeFileSync(filePath, text + '\n')
      return { ok: true, path: filePath, lines: text ? text.split('\n').length : 0 }
    }
  )

  // EUR→GBP at the ECB daily rate, for showing Cardmarket prices in pounds.
  ipcMain.handle('fx:rate', () => gbpRate())

  // --- Inventory data location (local vs cloud/Dropbox) ---
  const dataDir = resolveDataDir()
  const locationInfo = (): {
    inventoryDir: string
    inventoryDbPath: string
    localDir: string
    isCloud: boolean
    dropboxDefault: string | null
    conflicts: string[]
    locked: boolean
  } => ({
    inventoryDir: store.inventoryDir,
    inventoryDbPath: store.inventoryDbPath,
    localDir: dataDir,
    isCloud: path.resolve(store.inventoryDir) !== path.resolve(dataDir),
    dropboxDefault: defaultCloudInventoryDir(),
    conflicts: findConflictedCopies(store.inventoryDir),
    // Dev override pins the location; can't be changed from the UI.
    locked: !!process.env.MTG_CARDVAULT_DATA_DIR
  })

  ipcMain.handle('data:location', () => locationInfo())

  // Move the live inventory to `dir` (or, with no dir, to the detected Dropbox
  // folder) and remember it. `reset: true` moves it back to the local data dir.
  ipcMain.handle(
    'data:setLocation',
    (_e, args?: { dir?: string; reset?: boolean }) => {
      if (process.env.MTG_CARDVAULT_DATA_DIR) return { ...locationInfo(), error: 'locked' }
      let target = args?.dir
      if (args?.reset) target = dataDir
      if (!target) target = defaultCloudInventoryDir() ?? undefined
      if (!target) return { ...locationInfo(), error: 'no-dropbox' }
      try {
        store.relocateInventory(target)
        if (path.resolve(target) === path.resolve(dataDir)) clearInventoryDir(dataDir)
        else saveInventoryDir(dataDir, target)
        return locationInfo()
      } catch (err) {
        return { ...locationInfo(), error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Folder picker for a custom inventory location.
  ipcMain.handle('data:chooseLocation', async () => {
    if (process.env.MTG_CARDVAULT_DATA_DIR) return { ...locationInfo(), error: 'locked' }
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose a folder for the inventory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultCloudInventoryDir() ?? app.getPath('home')
    })
    if (canceled || !filePaths[0]) return { ...locationInfo(), canceled: true }
    try {
      store.relocateInventory(filePaths[0])
      saveInventoryDir(dataDir, filePaths[0])
      return locationInfo()
    } catch (err) {
      return { ...locationInfo(), error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Start (or reuse) the loopback viewer server and return its URL, so the
  // renderer can embed it in-app via an <iframe> — no separate window.
  ipcMain.handle('viewer:url', async () => {
    const url = await openInventoryViewer(store)
    return { url }
  })

  // "Show Inventory": loopback-only web viewer, shown in an in-app window
  // (no address bar, no browser). One window, refocused on repeat opens.
  ipcMain.handle('viewer:open', async (event) => {
    const url = await openInventoryViewer(store)
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.focus()
    } else {
      viewerWindow = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'MTG CardVault — Collection',
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      viewerWindow.on('closed', () => {
        viewerWindow = null
        // One click: closing the viewer drops the app back at the main menu.
        if (!event.sender.isDestroyed()) event.sender.send('viewer:closed')
      })
      // External links (e.g. "Full details on Scryfall") open in the user's
      // default browser, never inside this window.
      viewerWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        void shell.openExternal(target)
        return { action: 'deny' }
      })
      viewerWindow.webContents.on('will-navigate', (e, target) => {
        if (!target.startsWith(url)) {
          e.preventDefault()
          void shell.openExternal(target)
        }
      })
      await viewerWindow.loadURL(url)
    }
    return { url }
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

  // Renderer loop decisions (lock/stage/add/block) — same debug log, so the
  // frame reads and the decisions they triggered line up on one timeline.
  ipcMain.on('scan:note', (_e, note: string) => logScan({ mode: 'loop', note }))

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

  // ---- decks
  ipcMain.handle('deck:list', () => store.listDecks())
  ipcMain.handle('deck:create', (_e, a: { name: string; format?: DeckFormat }) =>
    store.createDeck(a.name, a.format ?? 'commander')
  )
  ipcMain.handle('deck:rename', (_e, a: { id: number; name: string }) =>
    store.renameDeck(a.id, a.name)
  )
  ipcMain.handle('deck:setFormat', (_e, a: { id: number; format: DeckFormat }) =>
    store.setDeckFormat(a.id, a.format)
  )
  ipcMain.handle('deck:delete', (_e, id: number) => store.deleteDeck(id))
  ipcMain.handle('deck:get', (_e, id: number) => store.getDeck(id))
  ipcMain.handle(
    'deck:addCard',
    (_e, a: { deckId: number; scryfallId: string; quantity?: number; category?: string }) =>
      store.addCardToDeck(a.deckId, a.scryfallId, a.quantity ?? 1, a.category ?? '')
  )
  ipcMain.handle('deck:setQuantity', (_e, a: { rowId: number; quantity: number }) =>
    store.setDeckCardQuantity(a.rowId, a.quantity)
  )
  ipcMain.handle('deck:setCategory', (_e, a: { rowId: number; category: string }) =>
    store.setDeckCardCategory(a.rowId, a.category)
  )
  ipcMain.handle('deck:setCommander', (_e, a: { rowId: number; replace: boolean }) =>
    store.setCommander(a.rowId, a.replace)
  )
  ipcMain.handle('deck:setImage', (_e, a: { deckId: number; imageUri: string | null }) =>
    store.setDeckImage(a.deckId, a.imageUri)
  )
  ipcMain.handle('deck:printings', (_e, name: string) => store.printingsForName(name))
  ipcMain.handle('deck:setPrinting', (_e, a: { rowId: number; scryfallId: string }) =>
    store.setDeckCardPrinting(a.rowId, a.scryfallId)
  )
  ipcMain.handle('deck:importText', (_e, a: { deckId: number; text: string }) =>
    store.importDeckText(a.deckId, a.text)
  )
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('deck:readFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import decklist',
      properties: ['openFile'],
      filters: [{ name: 'Decklist', extensions: ['txt', 'dec', 'csv', 'text'] }]
    })
    if (canceled || !filePaths[0]) return null
    const text = fs.readFileSync(filePaths[0], 'utf8')
    return { name: path.basename(filePaths[0]).replace(/\.[^.]+$/, ''), text }
  })
  // Cross-origin iframes (the embedded viewer) run out-of-process and can hold
  // keyboard focus; refocusing the window AND its top frame lets other inputs
  // type again (webContents.focus() alone isn't always enough).
  ipcMain.on('window:focusTop', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.focus()
    mainWindow.webContents.focus()
  })
  // Create a new deck from a public URL (Archidekt supported; Moxfield steers
  // to paste). Commander + real printings come through for free.
  ipcMain.handle('deck:importUrl', async (_e, url: string) => {
    try {
      const imported = await fetchDeckFromUrl(url)
      const deck = store.createDeck(imported.name, imported.format)
      const res = store.importDeckEntries(deck.id, imported.entries)
      return {
        ok: true as const,
        deckId: deck.id,
        name: imported.name,
        source: imported.source,
        added: res.added,
        missing: res.missing
      }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Copy the "missing singles" decklist to the clipboard (renderer clipboard is
  // locked down, so it's done here) — ready to paste into a shop or /buy-deck.
  ipcMain.handle('deck:copyMissing', (_e, id: number) => {
    const text = store.deckMissingText(id)
    clipboard.writeText(text)
    return { lines: text ? text.split('\n').length : 0 }
  })
  // Copy the full deck as a printing-specific list (for EDHPLAY / Moxfield etc.).
  ipcMain.handle('deck:exportCopy', (_e, id: number) => {
    const text = store.deckExportText(id)
    clipboard.writeText(text)
    return { lines: text ? text.split('\n').length : 0 }
  })
  // Save the same printing-specific list to a .txt file the user picks.
  ipcMain.handle('deck:exportFile', async (_e, id: number) => {
    const text = store.deckExportText(id)
    if (!text) return { canceled: true }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export deck',
      defaultPath: path.join(app.getPath('downloads'), 'deck.txt')
    })
    if (canceled || !filePath) return { canceled: true }
    fs.writeFileSync(filePath, text + '\n')
    return { ok: true, path: filePath, lines: text.split('\n').length }
  })

  ipcMain.handle('scan:corner', async (_e, imageVariants: string[]): Promise<CornerScanResult> => {
    const scan = await scanCorner(imageVariants, resolveTessdataDir())
    let resolution = store.resolveCorner(scan.parse)
    // Modern card whose set is newer than the reference DB: try live — but
    // only for REAL set codes; garbled reads ("LCIE") shouldn't hit the API.
    if (
      resolution.kind === 'none' &&
      scan.parse.setCode &&
      scan.parse.number &&
      store.isKnownSet(scan.parse.setCode)
    ) {
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
  // In dev (MTG_CARDVAULT_DATA_DIR set) keep everything together; otherwise
  // honour the shop's chosen inventory location (default: the local data dir).
  const inventoryDir = process.env.MTG_CARDVAULT_DATA_DIR
    ? dataDir
    : loadInventoryDir(dataDir, dataDir)
  store = new DataStore(dataDir, inventoryDir)
  console.log(`[cardvault] data dir: ${dataDir}`)
  console.log(`[cardvault] inventory dir: ${inventoryDir}`)
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
  closeInventoryViewer()
  store?.close()
})
