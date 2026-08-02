import { useCallback, useEffect, useRef, useState } from 'react'
import CameraPanel, { type CapturedFrame } from './components/CameraPanel'
import { playSuccess, playAttention, playUndo } from './scan/audio'
import faceHam from './assets/faces/spider-ham.svg'
import faceVenom from './assets/faces/venom.png'
import faceFisk from './assets/faces/fisk.svg'
import faceGwen from './assets/faces/spider-gwen.svg'
import faceOck from './assets/faces/doc-ock.svg'
import faceDoom from './assets/faces/doom.svg'
import faceNoir from './assets/faces/noir.svg'
import spideyIcon from './assets/spidey.svg'
import type {
  CardRef,
  CornerScanResult,
  Finish,
  InventorySummary,
  PreconSummary,
  RefProgress,
  RefStatus,
  SetInfo
} from '../../shared/types'

interface CapturePreview {
  cornerUrl: string
  width: number
  height: number
}

/** One face button per app section — the home screen launcher. */
type Section = 'home' | 'scan' | 'remove' | 'collection' | 'viewer' | 'precon' | 'data' | 'settings'

const SECTIONS: { id: Exclude<Section, 'home'>; label: string; face: string; blurb: string }[] = [
  { id: 'scan', label: 'Scan cards in', face: faceHam, blurb: 'Camera scanning, name mode & manual add' },
  { id: 'remove', label: 'Sell / Remove', face: faceVenom, blurb: 'Scan cards back out of stock' },
  { id: 'collection', label: 'Collection', face: faceFisk, blurb: 'Stock list, values & exports' },
  { id: 'viewer', label: 'Show Inventory', face: faceGwen, blurb: 'Browse the collection in your browser' },
  { id: 'precon', label: 'Precon import', face: faceOck, blurb: 'Bulk-add a preconstructed deck' },
  { id: 'data', label: 'Card data', face: faceDoom, blurb: 'Refresh the Scryfall reference' },
  { id: 'settings', label: 'Settings', face: faceNoir, blurb: 'Sounds & preferences' }
]

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'done'; result: CornerScanResult }
  | { status: 'error'; message: string }

// EUR→GBP (ECB daily) fetched once at startup; null → prices display as €.
// Module-level so every component reads it without prop-drilling; the App
// component re-renders everything once the rate arrives.
let fxGbpPerEur: number | null = null

/** Cardmarket price for display: £ at the ECB rate, € when offline. */
function cardmarket(eur: number | null | undefined): string | null {
  if (eur == null) return null
  const [symbol, value] = fxGbpPerEur != null ? ['£', eur * fxGbpPerEur] : ['€', eur]
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${Math.round(n / 1e3)} kB`
}

function ReferencePanel({
  status,
  onStatusChange
}: {
  status: RefStatus | null
  onStatusChange: () => void
}): React.JSX.Element {
  const [progress, setProgress] = useState<RefProgress | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => window.api.onRefProgress(setProgress), [])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setProgress(null)
    const result = await window.api.refreshReference()
    setBusy(false)
    if (!result.ok) setProgress({ phase: 'error', message: result.error })
    onStatusChange()
  }

  let progressText = ''
  let pct: number | null = null
  if (progress) {
    switch (progress.phase) {
      case 'listing':
        progressText = 'Fetching bulk data listing…'
        break
      case 'download':
        if (progress.totalBytes) {
          pct = Math.round(((progress.receivedBytes ?? 0) / progress.totalBytes) * 100)
          progressText = `Downloading ${formatBytes(progress.receivedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
        } else {
          progressText = `Downloading ${formatBytes(progress.receivedBytes ?? 0)}`
        }
        break
      case 'import':
        progressText = `Importing… ${progress.imported?.toLocaleString() ?? 0} cards`
        break
      case 'finalize':
        progressText = 'Finalising…'
        break
      case 'done':
        progressText = `Done — ${progress.imported?.toLocaleString()} cards imported`
        break
      case 'error':
        progressText = `Error: ${progress.message}`
        break
    }
  }

  return (
    <div className="ref-inline">
      <div>
          {status?.ready ? (
            <p className="muted small">
              {status.cardCount.toLocaleString()} printings · Scryfall{' '}
              {status.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : 'unknown'}
            </p>
          ) : (
            <p className="warn small">
              No card data yet — download it once to enable offline lookups.
            </p>
          )}
      </div>
        <button className="slim" onClick={refresh} disabled={busy}>
          {busy ? 'Refreshing…' : status?.ready ? 'Refresh card data' : 'Download card data'}
        </button>
      {progressText && (
        <div className="progress-area">
          <p className={`small ${progress?.phase === 'error' ? 'warn' : 'muted'}`}>
            {progressText}
          </p>
          {pct !== null && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CardPreview({
  card,
  finish,
  setFinish,
  quantity,
  setQuantity,
  onAdd,
  onCancel,
  actionLabel
}: {
  card: CardRef
  finish: Finish
  setFinish: (f: Finish) => void
  quantity: number
  setQuantity: (n: number) => void
  onAdd: () => void
  onCancel: () => void
  actionLabel?: string
}): React.JSX.Element {
  const eur = finish === 'nonfoil' ? card.pricesEur : (card.pricesEurFoil ?? card.pricesEur)
  const usd = finish === 'nonfoil' ? card.pricesUsd : (card.pricesUsdFoil ?? card.pricesUsd)
  const price = cardmarket(eur)
  return (
    <div className="preview">
      {card.imageUri ? (
        <img className="card-img" src={card.imageUri} alt={card.name} />
      ) : (
        <div className="card-img placeholder">no image</div>
      )}
      <div className="preview-details">
        <h3>{card.name}</h3>
        <p className="muted">
          {card.setName} ({card.setCode.toUpperCase()}) · #{card.collectorNumber} · {card.rarity}
        </p>
        <p className="muted">{card.typeLine}</p>
        {card.source === 'live' && <p className="warn">Fetched live from Scryfall (cache miss)</p>}
        <div className="finish-row">
          {(['nonfoil', 'foil', 'etched'] as Finish[]).map((f) => (
            <button
              key={f}
              className={`finish-btn ${finish === f ? 'active' : ''}`}
              disabled={!card.finishes.includes(f)}
              onClick={() => setFinish(f)}
            >
              {f}
            </button>
          ))}
          <label className="qty-label">
            Qty
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            />
          </label>
        </div>
        {(price != null || usd != null) && (
          <p className="price">
            {price ?? ''}
            {usd != null && <span className="muted small"> {price ? '· ' : ''}${usd.toFixed(2)}</span>}
          </p>
        )}
        <div className="action-row">
          <button className="primary" onClick={onAdd}>
            {actionLabel ?? 'Add to inventory (Enter)'}
          </button>
          <button onClick={onCancel}>Cancel (Esc)</button>
        </div>
        <p className="muted small">F toggles foil</p>
      </div>
    </div>
  )
}

/**
 * Set-code combobox: free text + a dropdown of "CODE — Set Name" rows that
 * filters on code or name, with a live hint naming the set the typed code
 * belongs to. Arrows navigate, Enter picks (or submits an exact code).
 */
function SetCombo({
  sets,
  value,
  onChange,
  onEnter,
  placeholder,
  inputRef
}: {
  sets: SetInfo[]
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const norm = value.trim().toLowerCase()
  const exact = sets.find((s) => s.code === norm)
  const matches = (
    norm.length === 0
      ? sets
      : sets.filter((s) => s.code.startsWith(norm) || s.name.toLowerCase().includes(norm))
  ).slice(0, 12)

  const pick = (s: SetInfo): void => {
    onChange(s.code.toUpperCase())
    setOpen(false)
  }

  return (
    <span className="setcombo">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Escape') {
            setOpen(false)
          } else if (e.key === 'Enter') {
            if (open && !exact && matches[hi]) {
              e.preventDefault()
              pick(matches[hi])
            } else {
              setOpen(false)
              onEnter?.()
            }
          }
        }}
      />
      {exact && <span className="set-hint">= {exact.name}</span>}
      {open && matches.length > 0 && (
        <ul className="setcombo-list">
          {matches.map((s, i) => (
            <li
              key={s.code}
              className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setHi(i)}
            >
              <b>{s.code.toUpperCase()}</b> — {s.name}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

function ScanReadout({
  result,
  onPick
}: {
  result: CornerScanResult
  onPick: (c: CardRef) => void
}): React.JSX.Element {
  const { resolution, parsed, confidence, ms } = result
  return (
    <div>
      {parsed.nameRead !== undefined ? (
        <p className="muted small">
          read name: <b>{parsed.nameRead || '—'}</b> · {Math.round(confidence)}% · {ms} ms
        </p>
      ) : (
        <p className="muted small">
          read: set <b>{parsed.setCode?.toUpperCase() ?? '—'}</b>
          {result.setConf != null && <> ({Math.round(result.setConf)}%)</>} · №{' '}
          <b>{parsed.number ?? '—'}</b>
          {result.numberConf != null && <> ({Math.round(result.numberConf)}%)</>}
          {parsed.total != null && <>/{parsed.total}</>} · year <b>{parsed.year ?? '—'}</b> ·{' '}
          {Math.round(confidence)}% overall · {ms} ms
        </p>
      )}
      {resolution.kind === 'exact' && (
        <p className="message">Matched — confirm below (Enter adds).</p>
      )}
      {resolution.kind === 'candidates' && (
        <>
          <p className="warn">
            Old frame (no set code printed) — {resolution.candidates!.length} sets share this
            numbering. Pick the right one:
          </p>
          <ul className="search-results">
            {resolution.candidates!.map((c) => (
              <li key={c.scryfallId}>
                <button className="link" onClick={() => onPick(c)}>
                  {c.name} — {c.setName} ({c.setCode.toUpperCase()}) #{c.collectorNumber}
                  {c.releasedAt ? ` · ${c.releasedAt.slice(0, 4)}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {resolution.kind === 'none' && (
        <p className="warn">
          Couldn't identify the card — rescan (sharper, fill the outline) or use manual entry
          below.
        </p>
      )}
      <details>
        <summary>raw OCR text</summary>
        <pre className="ocr-raw">{parsed.raw || '(empty)'}</pre>
      </details>
    </div>
  )
}

function PreconPanel({
  onAdded,
  standalone
}: {
  onAdded: (summary: string) => void
  standalone?: boolean
}): React.JSX.Element {
  const [decks, setDecks] = useState<PreconSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PreconSummary | null>(null)
  const [info, setInfo] = useState<{ name: string; totalCards: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadList = async (): Promise<void> => {
    if (decks) return
    try {
      setDecks(await window.api.preconList())
    } catch (err) {
      setError(`Couldn't fetch the deck list: ${err instanceof Error ? err.message : err}`)
    }
  }

  const filtered =
    decks && query.trim().length >= 2
      ? decks.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12)
      : []

  const select = async (d: PreconSummary): Promise<void> => {
    setSelected(d)
    setInfo(null)
    setError(null)
    try {
      setInfo(await window.api.preconInfo(d.fileName))
    } catch (err) {
      setError(`Couldn't fetch that deck: ${err instanceof Error ? err.message : err}`)
    }
  }

  const addAll = async (): Promise<void> => {
    if (!selected || !info) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.preconAdd(selected.fileName)
      playSuccess()
      onAdded(
        `📦 Added ${result.added} cards from "${result.deckName}"` +
          (result.missing.length > 0
            ? ` — ${result.missing.length} not resolved: ${result.missing.slice(0, 5).join(', ')}${result.missing.length > 5 ? '…' : ''}`
            : '')
      )
      setSelected(null)
      setInfo(null)
      setQuery('')
    } catch (err) {
      setError(`Add failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      <p className="muted small">
        Deck lists from MTGJSON — every card of the precon is added with its exact printing,
        counts and foils, priced into the scan log.
      </p>
      <div className="lookup-row">
        <label>
          Precon name
          <input
            value={query}
            placeholder="type at least 2 letters…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!decks && query.length >= 2 && <p className="muted">Loading deck list…</p>}
      {filtered.length > 0 && (
        <ul className="search-results">
          {filtered.map((d) => (
            <li key={d.fileName}>
              <button className="link" onClick={() => select(d)}>
                {d.name}
                {d.releaseDate ? ` · ${d.releaseDate.slice(0, 4)}` : ''} · {d.code.toUpperCase()}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="precon-confirm">
          <p>
            <b>{selected.name}</b>
            {info ? ` — ${info.totalCards} cards` : ' — fetching list…'}
          </p>
          <button className="primary" onClick={addAll} disabled={!info || busy}>
            {busy ? 'Adding…' : info ? `Add all ${info.totalCards} cards` : 'Loading…'}
          </button>
        </div>
      )}
      {error && <p className="warn">{error}</p>}
    </>
  )

  if (standalone) {
    return <StandalonePrecon loadList={loadList}>{body}</StandalonePrecon>
  }
  return (
    <details className="panel manual-panel" onToggle={(e) => e.currentTarget.open && loadList()}>
      <summary>
        <h2>Add a precon deck</h2>
      </summary>
      {body}
    </details>
  )
}

function StandalonePrecon({
  loadList,
  children
}: {
  loadList: () => Promise<void>
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <section className="panel">
      <h2>Add a precon deck</h2>
      {children}
    </section>
  )
}

export default function App(): React.JSX.Element {
  // Launcher navigation: one section on screen at a time, chosen from the
  // face buttons on the home screen. A ref mirrors it so the frame loop's
  // callbacks always see the CURRENT section without re-wiring.
  const [section, setSection] = useState<Section>('home')
  const sectionRef = useRef<Section>('home')

  const [refStatus, setRefStatus] = useState<RefStatus | null>(null)
  const [inventory, setInventory] = useState<InventorySummary | null>(null)

  const [setCode, setSetCode] = useState('')
  const [collectorNumber, setCollectorNumber] = useState('')
  const [card, setCard] = useState<CardRef | null>(null)
  const [finish, setFinish] = useState<Finish>('nonfoil')
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CardRef[]>([])
  const [showSearch, setShowSearch] = useState(false)

  const [cameraOn, setCameraOn] = useState(true)
  const [capture, setCapture] = useState<CapturePreview | null>(null)
  const [scan, setScan] = useState<ScanState>({ status: 'idle' })

  // Auto scan is the shop's default mode — remembered across launches.
  const [autoMode, setAutoMode] = useState(
    () => localStorage.getItem('cardvault.autoScan') !== '0'
  )
  const [autoStatus, setAutoStatus] = useState<string>('')

  // Corner mode reads the collector info; Name mode reads the title bar
  // (old cards / unreadable corners), optionally pinned to one set.
  const [scanMode, setScanMode] = useState<'corner' | 'name'>(
    () => (localStorage.getItem('cardvault.scanMode') === 'name' ? 'name' : 'corner')
  )
  const [pinnedSet, setPinnedSet] = useState(
    () => localStorage.getItem('cardvault.pinnedSet') ?? ''
  )
  const scanFrame = useCallback(
    (c: CapturedFrame): Promise<CornerScanResult> =>
      scanMode === 'name'
        ? window.api.scanTitle(c.titleVariants, pinnedSet.trim() || null)
        : window.api.scanCorner(c.cornerVariants),
    [scanMode, pinnedSet]
  )
  // Lock loop state — a ref, not state: it mutates on every pumped frame.
  const auto = useRef({
    busy: false,
    busySince: 0, // watchdog: a wedged scan call must never freeze the loop
    lastId: null as string | null, // exact id seen on the previous frame
    hits: 0, // consecutive frames agreeing on lastId
    lockConf: 0, // lowest number-token confidence across the agreeing frames
    lastAddedId: null as string | null,
    lastAddTime: 0, // same-card cooldown floor: flaky frames can't fake a swap
    clearFrames: 0, // frames since add that did NOT show lastAddedId
    missStreak: 0, // consecutive frames with content but no lock
    warned: false // attention beep already played this episode
  })
  const undoStack = useRef<
    { scryfallId: string; finish: Finish; name: string; action: 'add' | 'remove'; card?: CardRef }[]
  >([])
  // While a candidates pick-list is on screen, noisy frames must not blink
  // it away — the operator is trying to CLICK it (live-log finding).
  const candidatesHold = useRef(0)

  // Collection date filter (YYYY-MM-DD, either side open). Refs mirror the
  // state so loadInventory always reads the current bounds.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const dateFromRef = useRef('')
  const dateToRef = useRef('')
  const dateOpts = useCallback(
    () => ({
      from: dateFromRef.current || undefined,
      to: dateToRef.current || undefined
    }),
    []
  )
  const rangeText = useCallback(() => {
    const f = dateFromRef.current
    const t = dateToRef.current
    if (f && t) return `scanned ${f} → ${t}`
    if (f) return `scanned since ${f}`
    if (t) return `scanned up to ${t}`
    return 'all cards'
  }, [])

  const copyExport = useCallback(
    async (format: 'list' | 'csv') => {
      const { lines } = await window.api.exportCollection(format, dateOpts())
      setMessage(
        lines > 0
          ? `📋 Copied ${lines} rows (${rangeText()}, ${format === 'csv' ? 'CSV' : 'plain list'})`
          : 'Nothing to export for this filter'
      )
    },
    [dateOpts, rangeText]
  )

  const downloadExport = useCallback(
    async (format: 'list' | 'csv') => {
      const result = await window.api.exportFile(format, dateOpts())
      if (result.canceled) return
      setMessage(
        result.ok
          ? `⬇ Saved ${result.lines} rows (${rangeText()}) to ${result.path}`
          : 'Export failed'
      )
    },
    [dateOpts, rangeText]
  )

  // A low-confidence lock is STAGED, not blocking: shown for a glance/foil
  // flip, committed automatically when the next card locks. State drives the
  // UI; the ref gives the frame loop a non-stale view.
  const [pending, setPendingState] = useState<{ card: CardRef; finish: Finish } | null>(null)
  const pendingRef = useRef<{ card: CardRef; finish: Finish } | null>(null)
  const pendingClear = useRef(0) // frames since staging that did NOT show the pending card
  const pendingAgree = useRef(0) // further frames agreeing with the staged card
  const setPending = useCallback((p: { card: CardRef; finish: Finish } | null) => {
    pendingRef.current = p
    pendingClear.current = 0
    pendingAgree.current = 0
    setPendingState(p)
  }, [])

  const setInputRef = useRef<HTMLInputElement>(null)
  const cnInputRef = useRef<HTMLInputElement>(null)

  const loadStatus = useCallback(() => {
    window.api.refStatus().then(setRefStatus)
  }, [])
  const loadInventory = useCallback(() => {
    window.api
      .listInventory({
        from: dateFromRef.current || undefined,
        to: dateToRef.current || undefined
      })
      .then(setInventory)
  }, [])

  // Set list for the set-code dropdowns — loaded at start, refreshed after
  // a card-data refresh (new sets appear).
  const [sets, setSets] = useState<SetInfo[]>([])
  const loadSets = useCallback(() => {
    window.api.listSets().then(setSets)
  }, [])

  useEffect(() => {
    if (!window.api) return
    loadStatus()
    loadInventory()
    loadSets()
    // Cardmarket £ display: grab the ECB rate, then re-render prices.
    window.api.fxRate().then((r) => {
      if (r.gbpPerEur != null) {
        fxGbpPerEur = r.gbpPerEur
        loadInventory()
      }
    })
  }, [loadStatus, loadInventory, loadSets])

  const resetForNext = useCallback(() => {
    setCard(null)
    // The set code is STICKY — runs of same-set cards are number → Enter →
    // number → Enter. Only the collector number clears.
    setCollectorNumber('')
    setQuantity(1)
    setSearchResults([])
    setShowSearch(false)
    setCapture(null)
    setScan({ status: 'idle' })
    cnInputRef.current?.focus()
  }, [])

  const applyCard = useCallback(
    (c: CardRef) => {
      setCard(c)
      if (!c.finishes.includes(finish)) setFinish(c.finishes[0] ?? 'nonfoil')
    },
    [finish]
  )

  const lookup = useCallback(async () => {
    if (!setCode.trim() || !collectorNumber.trim()) return
    setMessage(null)
    const found = await window.api.lookupCard({ setCode, collectorNumber })
    if (!found) {
      setCard(null)
      setShowSearch(true)
      setMessage(
        `No match for ${setCode.toUpperCase()} #${collectorNumber} — try the name search below.`
      )
      return
    }
    applyCard(found)
  }, [setCode, collectorNumber, applyCard])

  const autoAdd = useCallback(
    async (c: CardRef, finishOverride?: Finish) => {
      // Finish decisions happen AFTER the scan (F key / row selects) — keep
      // the loop moving. Foil-only printings land on their only finish.
      const addFinish: Finish =
        finishOverride ?? (c.finishes.includes('nonfoil') ? 'nonfoil' : (c.finishes[0] ?? 'nonfoil'))
      window.api.note?.(`ADD ${c.name} [${c.setCode} #${c.collectorNumber}] ${addFinish}`)
      const item = await window.api.addCard(c, addFinish, 1)
      undoStack.current.push({
        scryfallId: c.scryfallId,
        finish: addFinish,
        name: c.name,
        action: 'add'
      })
      playSuccess()
      setFlash(true)
      setTimeout(() => setFlash(false), 350)
      setMessage(
        `✓ ${item.name} (${item.setCode.toUpperCase()} #${item.collectorNumber}, ${item.finish}) — now ×${item.quantity}`
      )
      loadInventory()
    },
    [loadInventory]
  )

  /**
   * Sell / Remove mode: same scan loop, opposite direction. Tries the
   * scanned printing's stacks in finish order until one yields stock; a
   * card the shop doesn't stock beeps attention instead of going negative.
   */
  const removeStock = useCallback(
    async (c: CardRef, finishOverride?: Finish, qty = 1) => {
      const order: Finish[] = finishOverride
        ? [finishOverride]
        : ['nonfoil', 'foil', 'etched']
      let item: import('../../shared/types').InventoryItem | null = null
      let used: Finish | null = null
      for (const f of order) {
        item = await window.api.removeCard(c.scryfallId, f, qty)
        if (item) {
          used = f
          break
        }
      }
      if (!item || !used) {
        playAttention()
        window.api.note?.(`SELL-MISS ${c.name} [${c.setCode} #${c.collectorNumber}]`)
        setMessage(`⚠ ${c.name} (${c.setCode.toUpperCase()} #${c.collectorNumber}) — none in stock`)
        return
      }
      undoStack.current.push({
        scryfallId: c.scryfallId,
        finish: used,
        name: c.name,
        action: 'remove',
        card: c
      })
      window.api.note?.(`SELL ${c.name} [${c.setCode} #${c.collectorNumber}] ${used}`)
      playUndo()
      setFlash(true)
      setTimeout(() => setFlash(false), 350)
      setMessage(
        `✂ Sold ${qty}× ${item.name} (${item.setCode.toUpperCase()} #${item.collectorNumber}, ${used}) — ×${item.quantity} left`
      )
      loadInventory()
    },
    [loadInventory]
  )

  /** Route a locked/confirmed card to add or remove, per the open section. */
  const applyStock = useCallback(
    async (c: CardRef, finishOverride?: Finish) => {
      if (sectionRef.current === 'remove') return removeStock(c, finishOverride)
      return autoAdd(c, finishOverride)
    },
    [autoAdd, removeStock]
  )

  const commitPending = useCallback(async () => {
    const p = pendingRef.current
    if (!p) return
    setPending(null)
    // Arm the same-card cooldown for the committed card too — if it's still
    // (or back) in frame, it must not immediately re-stage.
    auto.current.lastAddedId = p.card.scryfallId
    auto.current.clearFrames = 0
    auto.current.lastAddTime = Date.now()
    await applyStock(p.card, p.finish)
  }, [applyStock, setPending])

  const discardPending = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    setPending(null)
    playUndo()
    setMessage(`✗ Discarded staged ${p.card.name}`)
    setAutoStatus('watching…')
  }, [setPending])

  /** F after a beep: cycle the just-added copy's finish (foil → etched → back). */
  const flipLastFinish = useCallback(async () => {
    const last = undoStack.current[undoStack.current.length - 1]
    if (!last || last.action !== 'add') return
    const order: Finish[] = ['nonfoil', 'foil', 'etched']
    const next = order[(order.indexOf(last.finish) + 1) % order.length]
    const moved = await window.api.moveFinish(last.scryfallId, last.finish, next, 1)
    if (!moved) return
    last.finish = next
    playUndo()
    setMessage(`★ ${last.name} → ${next}`)
    loadInventory()
  }, [loadInventory])

  const undoLast = useCallback(async () => {
    const last = undoStack.current.pop()
    if (!last) return
    if (last.action === 'remove' && last.card) {
      await window.api.addCard(last.card, last.finish, 1)
      setMessage(`↩ Restocked 1× ${last.name}`)
    } else {
      await window.api.removeCard(last.scryfallId, last.finish, 1)
      setMessage(`↩ Removed 1× ${last.name}`)
    }
    playUndo()
    loadInventory()
  }, [loadInventory])

  /** The lock loop: act only on frames that keep agreeing with each other. */
  const onAutoFrame = useCallback(
    async (c: CapturedFrame) => {
      const a = auto.current
      if (card) {
        // Never silent: say WHY the loop is holding.
        setAutoStatus('paused — match open below (Enter adds, Esc dismisses)')
        return
      }
      if (a.busy) {
        // Watchdog: if a scan call has been stuck >8s (hung network, dead
        // worker), abandon it and let the loop breathe again.
        if (Date.now() - a.busySince > 8000) {
          a.busy = false
          setAutoStatus('scan call timed out — resuming…')
        }
        return
      }
      a.busy = true
      a.busySince = Date.now()
      try {
        const result = await scanFrame(c)
        const res = result.resolution
        const readSomething = Boolean(
          result.parsed.number || result.parsed.setCode || result.parsed.nameRead
        )

        // Liveness: refresh the crop thumbnail + readout on EVERY processed
        // frame — EXCEPT while a pick-list is showing: it must hold still to
        // be clickable, so only fresh candidates/exact results may replace it.
        if (res.kind === 'candidates') candidatesHold.current = Date.now() + 6000
        else if (res.kind === 'exact') candidatesHold.current = 0
        const holdingList = Date.now() < candidatesHold.current && res.kind === 'none'
        if (!holdingList) {
          setCapture({
            cornerUrl: (scanMode === 'name' ? c.title : c.corner).toDataURL('image/png'),
            width: c.width,
            height: c.height
          })
          setScan({ status: 'done', result })
        }

        // Track whether the staged (pending) card has left the frame.
        const exactId = res.kind === 'exact' && res.card ? res.card.scryfallId : null
        if (pendingRef.current && exactId !== pendingRef.current.card.scryfallId) {
          pendingClear.current++
        }

        if (res.kind === 'exact' && res.card) {
          const id = res.card.scryfallId
          const frameConf = result.numberConf ?? result.confidence
          a.missStreak = 0
          // Seeing a different card is proof the last-added one left the frame.
          if (a.lastAddedId && id !== a.lastAddedId) a.clearFrames++
          if (
            pendingRef.current &&
            id === pendingRef.current.card.scryfallId &&
            pendingClear.current < 2
          ) {
            // Staged card still in frame and still reading the same: that
            // sustained agreement IS confidence. One good read — or two more
            // agreeing shaky ones — confirms it.
            pendingAgree.current++
            if (frameConf >= 65 || pendingAgree.current >= 2) {
              setAutoStatus('')
              await commitPending()
            } else {
              setAutoStatus('staged — hold steady to confirm, or bring the next card…')
            }
            return
          }
          if (
            id === a.lastAddedId &&
            (a.clearFrames < 2 || Date.now() - a.lastAddTime < 2500)
          ) {
            window.api.note?.(
              `BLOCK cooldown ${res.card.name} clear=${a.clearFrames} dt=${Date.now() - a.lastAddTime}`
            )
            // Same card shortly after its add. Crucially: seeing it again
            // RESETS the departure evidence — flaky cards (basic lands)
            // scatter unreadable frames while still being held, and those
            // must not accumulate into a fake "card swapped" signal. The
            // card has to be CONTINUOUSLY gone to count as gone.
            a.clearFrames = 0
            setAutoStatus(`✓ added — next card…`)
            return
          }
          if (id === a.lastId) {
            a.hits++
            a.lockConf = Math.min(a.lockConf, frameConf)
          } else {
            a.lastId = id
            a.hits = 1
            a.lockConf = frameConf
          }
          // Corner mode needs two agreeing frames (a digit misread can name a
          // different VALID card). An exact name-mode hit can't — OCR would
          // have to garble one real card name into another — so it locks on
          // the first frame.
          const framesNeeded =
            result.parsed.nameRead !== undefined && frameConf >= 85 ? 1 : 2
          if (a.hits >= framesNeeded) {
            const lockConf = a.lockConf
            a.hits = 0
            a.lastId = null
            a.warned = false
            window.api.note?.(`LOCK ${res.card.name} conf=${Math.round(lockConf)}`)
            const p = pendingRef.current
            if (p && p.card.scryfallId !== id) {
              // A different card's lock NEVER commits a stage. Camera frames
              // can't reliably tell "card swapped" from "same card flickered"
              // (James's double-adds), so the rule is absolute: a stage only
              // commits by confirming ITSELF (sustained agreement / Enter).
              // No beep = didn't count.
              window.api.note?.(`DROP stage ${p.card.name} (superseded by lock)`)
              setPending(null)
              setMessage(`✗ not counted (uncertain read superseded): ${p.card.name}`)
            }
            if (lockConf >= 65) {
              a.lastAddedId = id
              a.clearFrames = 0
              a.lastAddTime = Date.now()
              setAutoStatus('')
              await applyStock(res.card)
            } else {
              // Shaky digit read: stage it, keep scanning. Visible for a
              // foil-flip or discard; the next lock commits it untouched.
              playAttention()
              window.api.note?.(`STAGE ${res.card.name} conf=${Math.round(lockConf)}`)
              setPending({
                card: res.card,
                finish: res.card.finishes.includes('nonfoil')
                  ? 'nonfoil'
                  : (res.card.finishes[0] ?? 'nonfoil')
              })
              setAutoStatus(
                `staged at ${Math.round(lockConf)}% — next card commits · Enter now · F foil · Backspace discard`
              )
            }
          } else {
            // Don't parade names from junk reads — a phantom one-off match
            // flashing 'locking: <random card>' reads as thrashing.
            setAutoStatus(frameConf >= 35 ? `locking: ${res.card.name}…` : 'reading…')
          }
          return
        }

        // Not an exact hit on this frame — counts as "last-added card gone".
        a.lastId = null
        a.hits = 0
        a.clearFrames++

        if (res.kind === 'candidates') {
          // Needs a human tap — ask ONCE per presentation, not every frame.
          if (!a.warned) {
            a.warned = true
            playAttention()
          }
          setAutoStatus('ambiguous — pick from the list (or set a set pin)')
          return
        }

        if (readSomething) {
          a.missStreak++
          const p = result.parsed
          setAutoStatus(
            p.nameRead
              ? `saw "${p.nameRead}" — no match yet, adjusting…`
              : `saw ${p.setCode?.toUpperCase() ?? '—'} #${p.number ?? '—'}${
                  p.total ? `/${p.total}` : ''
                } — no match yet, adjusting…`
          )
          if (a.missStreak >= 4 && !a.warned) {
            a.warned = true
            playAttention()
            setAutoStatus("can't lock — nudge the card or check focus (raw read below)")
          }
        } else {
          // Empty frame: episode over, ready for the next card.
          a.missStreak = 0
          a.warned = false
          setAutoStatus('watching — no card text in the strip')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        window.api.note?.(`ERROR ${msg}`)
        setMessage(`⚠ scan loop error: ${msg}`)
        setAutoStatus(`scan error: ${msg}`)
      } finally {
        auto.current.busy = false
      }
    },
    [card, applyStock, commitPending, setPending, scanFrame, scanMode]
  )

  const onCapture = useCallback(
    async (c: CapturedFrame, isAuto: boolean) => {
      if (isAuto) return onAutoFrame(c)
      setCapture({
        cornerUrl: (scanMode === 'name' ? c.title : c.corner).toDataURL('image/png'),
        width: c.width,
        height: c.height
      })
      setCard(null)
      setMessage(null)
      setScan({ status: 'scanning' })
      try {
        const result = await scanFrame(c)
        setScan({ status: 'done', result })
        if (result.resolution.kind === 'exact' && result.resolution.card) {
          applyCard(result.resolution.card)
        }
      } catch (err) {
        setScan({
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    },
    [applyCard, onAutoFrame, scanFrame, scanMode]
  )

  const addCard = useCallback(async () => {
    if (!card) return
    if (autoMode) {
      // Confirmed via preview during auto scan: arm the same-card cooldown
      // so the card still in frame doesn't immediately re-add (or re-sell).
      auto.current.lastAddedId = card.scryfallId
      auto.current.clearFrames = 0
      auto.current.lastAddTime = Date.now()
    }
    if (sectionRef.current === 'remove') {
      await removeStock(card, finish, quantity)
      resetForNext()
      return
    }
    const item = await window.api.addCard(card, finish, quantity)
    undoStack.current.push({ scryfallId: card.scryfallId, finish, name: card.name, action: 'add' })
    playSuccess()
    setMessage(
      `Added ${item.name} (${item.setCode.toUpperCase()} #${item.collectorNumber}, ${item.finish}) — now ×${item.quantity}`
    )
    setFlash(true)
    setTimeout(() => setFlash(false), 350)
    loadInventory()
    resetForNext()
  }, [card, finish, quantity, autoMode, loadInventory, resetForNext, removeStock])

  /** Navigate between sections; scanning state never leaks across. */
  const go = useCallback(
    (s: Section) => {
      const leaving = sectionRef.current
      if (pendingRef.current) {
        // Leaving Scan commits the stage ("probably right", same rule as
        // toggling auto off); leaving Sell just drops it — selling stock on
        // a low-confidence read nobody confirmed would be worse.
        if (leaving === 'scan') void commitPending()
        else setPending(null)
      }
      auto.current = {
        busy: false,
        busySince: 0,
        lastId: null,
        hits: 0,
        lockConf: 0,
        lastAddedId: null,
        lastAddTime: 0,
        clearFrames: 0,
        missStreak: 0,
        warned: false
      }
      setCard(null)
      setCapture(null)
      setScan({ status: 'idle' })
      setMessage(null)
      setAutoStatus('')
      setShowSearch(false)
      sectionRef.current = s
      setSection(s)
    },
    [commitPending, setPending]
  )

  // Entering Show Inventory opens the browser straight away.
  useEffect(() => {
    if (section === 'viewer') void window.api.openViewer()
  }, [section])

  // Closing the viewer window returns the app to the main menu — one click.
  useEffect(
    () =>
      window.api.onViewerClosed(() => {
        if (sectionRef.current === 'viewer') go('home')
      }),
    [go]
  )

  // Keyboard flow. Preview open: Enter = confirm, F = toggle foil, Esc =
  // reject. No preview: F = sticky finish for auto-adds, Backspace = undo
  // the last add.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Scan-loop keys belong to the scanning sections only.
      if (sectionRef.current !== 'scan' && sectionRef.current !== 'remove') return
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      if (card) {
        if (e.key === 'Enter') {
          e.preventDefault()
          addCard()
        } else if (e.key === 'Escape') {
          resetForNext()
        } else if ((e.key === 'f' || e.key === 'F') && !inInput) {
          const options = card.finishes
          if (options.length > 1) {
            setFinish(options[(options.indexOf(finish) + 1) % options.length])
          }
        }
        return
      }
      if (inInput) return
      if (pending) {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitPending()
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault()
          discardPending()
        } else if (e.key === 'f' || e.key === 'F') {
          const options = pending.card.finishes.length > 0 ? pending.card.finishes : ['nonfoil' as Finish]
          const next = options[(options.indexOf(pending.finish) + 1) % options.length]
          setPending({ ...pending, finish: next })
        }
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        flipLastFinish()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        undoLast()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [card, finish, pending, addCard, resetForNext, undoLast, flipLastFinish, commitPending, discardPending, setPending])

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearchResults(await window.api.searchCards(searchQuery))
  }, [searchQuery])

  if (typeof window.api === 'undefined') {
    return (
      <div className="app">
        <p className="warn">
          Renderer loaded outside Electron — the preload API is unavailable.
        </p>
      </div>
    )
  }

  const sectionMeta = SECTIONS.find((s) => s.id === section)

  return (
    <div className={`app ${flash ? 'flash' : ''}`}>
      <header>
        <h1 className="app-title" onClick={() => go('home')} title="Home">
          🕷 MTG CardVault
        </h1>
        {section !== 'home' && sectionMeta && (
          <>
            <img className="header-face" src={sectionMeta.face} alt="" />
            <span className="section-name">{sectionMeta.label}</span>
            <button className="home-btn" onClick={() => go('home')}>
              <img className="btn-icon" src={spideyIcon} alt="" /> Return to main menu
            </button>
          </>
        )}
      </header>

      {section === 'home' && (
        <div className="home">
          {!refStatus?.ready && (
            <p className="warn home-warn">
              No card data yet — open <b>Card data</b> and download it once to enable scanning.
            </p>
          )}
          <div className="home-grid">
            {SECTIONS.map((s) => (
              <button key={s.id} className="face-btn" onClick={() => go(s.id)}>
                <img src={s.face} alt={s.label} />
                <span className="face-label">{s.label}</span>
                <span className="face-blurb">{s.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(section === 'scan' || section === 'remove') && (
      <div className="section-body">
      {section === 'remove' && (
        <p className="sell-banner">
          ✂ Sell mode — every locked scan REMOVES one copy from stock. Cards not in stock
          beep and are ignored.
        </p>
      )}
      <section className="panel">
        <div className="ref-row">
          <h2>{section === 'remove' ? 'Scan card to sell' : 'Scan card'}</h2>
          <div className="toolbar-right">
            <button
              className={autoMode ? 'primary' : ''}
              onClick={() => {
                const next = !autoMode
                if (!next) commitPending() // staged card was "probably right"
                auto.current = {
                  busy: false,
                  busySince: 0,
                  lastId: null,
                  hits: 0,
                  lockConf: 0,
                  lastAddedId: null,
                  lastAddTime: 0,
                  clearFrames: 0,
                  missStreak: 0,
                  warned: false
                }
                setAutoStatus(next ? 'watching…' : '')
                setAutoMode(next)
                localStorage.setItem('cardvault.autoScan', next ? '1' : '0')
              }}
              disabled={!refStatus?.ready}
            >
              {autoMode ? '⏸ Stop auto scan' : '▶ Auto scan'}
            </button>
            <button onClick={() => setCameraOn((v) => !v)}>
              {cameraOn ? 'Hide camera' : 'Show camera'}
            </button>
          </div>
        </div>
        <div className="auto-bar">
          <span className="finish-row">
            <button
              className={`finish-btn ${scanMode === 'corner' ? 'active' : ''}`}
              onClick={() => {
                setScanMode('corner')
                localStorage.setItem('cardvault.scanMode', 'corner')
              }}
            >
              Corner №
            </button>
            <button
              className={`finish-btn ${scanMode === 'name' ? 'active' : ''}`}
              onClick={() => {
                setScanMode('name')
                localStorage.setItem('cardvault.scanMode', 'name')
              }}
            >
              Name (old cards)
            </button>
          </span>
          {scanMode === 'name' && (
            <label className="pin-label">
              Set pin
              <SetCombo
                sets={sets}
                value={pinnedSet}
                placeholder="e.g. M19 (optional)"
                onChange={(v) => {
                  setPinnedSet(v)
                  localStorage.setItem('cardvault.pinnedSet', v)
                }}
              />
            </label>
          )}
          {autoMode && (
            <>
              <span className={`auto-status ${autoStatus.startsWith('✓') ? 'ok' : ''}`}>
                {autoStatus || 'watching…'}
              </span>
              <span className="muted small">
                hold card until the beep · F = last foil · Backspace undo
              </span>
            </>
          )}
        </div>
        {cameraOn && (
          <CameraPanel
            onCapture={onCapture}
            autoMode={autoMode}
            guideRegion={scanMode === 'name' ? 'title' : 'corner'}
          />
        )}
        {capture && (
          <div className="capture-preview">
            <div className="capture-row">
              <figure>
                <img className="capture-crop" src={capture.cornerUrl} alt="collector info crop" />
                <figcaption className="muted small">
                  collector info crop ({capture.width}×{capture.height} frame)
                </figcaption>
              </figure>
              <div className="scan-status">
                {scan.status === 'scanning' && <p className="muted">Reading…</p>}
                {scan.status === 'error' && <p className="warn">OCR failed: {scan.message}</p>}
                {scan.status === 'done' && (
                  <ScanReadout
                    result={scan.result}
                    onPick={(c) => {
                      applyCard(c)
                      setScan({ status: 'idle' })
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {(message || card || pending) && (
        <section className="panel">
          <h2>Match</h2>
          {message && <p className="message">{message}</p>}
          {pending && !card && (
            <div className="staged">
              <p className="warn">
                ⏳ Uncertain read — hold the card steady until the beep to count it (or
                Enter) · F finish · Backspace discards · swapping cards drops it
              </p>
              <CardPreview
                card={pending.card}
                finish={pending.finish}
                setFinish={(f) => setPending({ ...pending, finish: f })}
                quantity={1}
                setQuantity={() => {}}
                onAdd={commitPending}
                onCancel={discardPending}
                actionLabel={section === 'remove' ? 'Remove from stock (Enter)' : undefined}
              />
            </div>
          )}
          {card && (
            <CardPreview
              card={card}
              finish={finish}
              setFinish={setFinish}
              quantity={quantity}
              setQuantity={setQuantity}
              onAdd={addCard}
              onCancel={resetForNext}
              actionLabel={section === 'remove' ? 'Remove from stock (Enter)' : undefined}
            />
          )}
        </section>
      )}

      <details className="panel manual-panel" open={showSearch || undefined}>
        <summary>
          <h2>Add card manually / name search</h2>
        </summary>
        <div className="lookup-row">
          <label>
            Set
            <select
              className="set-select"
              value={sets.find((s) => s.code === setCode.trim().toLowerCase())?.code ?? ''}
              onChange={(e) => {
                if (e.target.value) setSetCode(e.target.value.toUpperCase())
              }}
            >
              <option value="">— select a set —</option>
              {sets.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label>
            Set code
            <input
              ref={setInputRef}
              className="code-input"
              value={setCode}
              placeholder="SPM"
              maxLength={6}
              onChange={(e) => setSetCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
            />
          </label>
          <label>
            Collector №
            <input
              ref={cnInputRef}
              value={collectorNumber}
              placeholder="e.g. 0123/280 or 123"
              onChange={(e) => setCollectorNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
            />
          </label>
          <button className="primary" onClick={lookup} disabled={!refStatus?.ready && !navigator.onLine}>
            Look up
          </button>
        </div>

        {showSearch && (
          <div className="search-area">
            <div className="lookup-row">
              <label>
                Card name
                <input
                  value={searchQuery}
                  placeholder="type a card name…"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
              </label>
              <button onClick={runSearch}>Search</button>
            </div>
            {searchResults.length > 0 && (
              <ul className="search-results">
                {searchResults.map((c) => (
                  <li key={c.scryfallId}>
                    <button
                      className="link"
                      onClick={() => {
                        applyCard(c)
                        setShowSearch(false)
                      }}
                    >
                      {c.name} — {c.setName} ({c.setCode.toUpperCase()}) #{c.collectorNumber}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </details>

      </div>
      )}

      {section === 'precon' && (
        <div className="section-body">
          {message && <p className="message">{message}</p>}
          <PreconPanel
            standalone
            onAdded={(summary) => {
              setMessage(summary)
              loadInventory()
            }}
          />
        </div>
      )}

      {section === 'viewer' && (
        <div className="section-body">
          <section className="panel">
            <h2>Show Inventory</h2>
            <p className="muted">
              The collection viewer just opened in its own window — card images, Cardmarket
              £ prices, set browsing, and an any-card search across every printing.
            </p>
            <button className="primary" onClick={() => void window.api.openViewer()}>
              Open it again
            </button>
          </section>
        </div>
      )}

      {section === 'data' && (
        <div className="section-body">
          <section className="panel">
            <h2>Card data</h2>
            <p className="muted small">
              The offline Scryfall reference powers every lookup and price (Cardmarket € and
              USD). Refresh it roughly weekly, or right after a new set releases.
            </p>
            <ReferencePanel
              status={refStatus}
              onStatusChange={() => {
                loadStatus()
                loadSets()
              }}
            />
          </section>
        </div>
      )}

      {section === 'settings' && (
        <div className="section-body">
          <section className="panel">
            <h2>Settings</h2>
            <label className="tick-label">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => {
                  setAutoMode(e.target.checked)
                  localStorage.setItem('cardvault.autoScan', e.target.checked ? '1' : '0')
                }}
              />{' '}
              Auto scan on by default
            </label>
            <p className="muted small">
              Camera selection lives inside the scan view. Sound check:
            </p>
            <div className="action-row">
              <button onClick={() => playSuccess()}>✓ counted beep</button>
              <button onClick={() => playAttention()}>⚠ attention beep</button>
              <button onClick={() => playUndo()}>↩ undo blip</button>
            </div>
          </section>
        </div>
      )}

      {section === 'collection' && (
      <div className="section-body">
      <section className="panel collection">
        <div className="ref-row collection-head">
          <h2>Collection</h2>
          {inventory && (
            <p className="muted">
              {inventory.totalCards.toLocaleString()} cards ·{' '}
              {inventory.distinctStacks.toLocaleString()} stacks ·{' '}
              <span className="collection-value" title="Cardmarket value (ECB rate) · USD value">
                {cardmarket(inventory.totalValueEur) ?? '—'}
              </span>{' '}
              · ${inventory.totalValue.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
          )}
          <label className="date-label">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                dateFromRef.current = e.target.value
                loadInventory()
              }}
            />
          </label>
          <label className="date-label">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                dateToRef.current = e.target.value
                loadInventory()
              }}
            />
          </label>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                dateFromRef.current = ''
                dateToRef.current = ''
                loadInventory()
              }}
            >
              ✕ Clear filters
            </button>
          )}
          <button
            title="Plain list: 1 Island (FIN) 297"
            onClick={() => copyExport('list')}
          >
            📋 Copy list
          </button>
          <button title="CSV: quantity,card-name,expansion,id" onClick={() => copyExport('csv')}>
            Copy CSV
          </button>
          <button
            title="Save a CSV file of the filtered collection"
            onClick={() => downloadExport('csv')}
          >
            ⬇ CSV file
          </button>
          <button
            title="Save a plain deck-list file of the filtered collection"
            onClick={() => downloadExport('list')}
          >
            ⬇ Deck list
          </button>
          <button
            title="Browse the collection in your web browser — images, Cardmarket prices, any-card search"
            onClick={() => void window.api.openViewer()}
          >
            🖼 Show Inventory
          </button>
        </div>
        {message && <p className="message">{message}</p>}
        {inventory && inventory.items.length > 0 ? (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Name</th>
                <th>Set</th>
                <th>№</th>
                <th>Finish</th>
                <th>Rarity</th>
                <th>Value</th>
                <th>Scanned (UTC)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inventory.items.map((item) => (
                <tr key={item.id}>
                  <td>×{item.quantity}</td>
                  <td>{item.name}</td>
                  <td>{item.setCode.toUpperCase()}</td>
                  <td>{item.collectorNumber}</td>
                  <td>
                    <select
                      className="finish-select"
                      value={item.finish}
                      title="change finish (moves one copy)"
                      onChange={async (e) => {
                        const to = e.target.value as Finish
                        await window.api.moveFinish(item.scryfallId, item.finish, to, 1)
                        setMessage(`★ ${item.name}: 1× ${item.finish} → ${to}`)
                        loadInventory()
                      }}
                    >
                      {(['nonfoil', 'foil', 'etched'] as Finish[]).map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{item.rarity}</td>
                  <td>
                    {cardmarket(item.lastPriceEur) ??
                      (item.lastPrice != null ? `$${item.lastPrice.toFixed(2)}` : '—')}
                  </td>
                  <td className="muted small">
                    {item.lastScannedAt
                      ? item.lastScannedAt.replace('T', ' ').replace('Z', '')
                      : '—'}
                  </td>
                  <td>
                    <button
                      className="row-remove"
                      title="remove one copy"
                      onClick={async () => {
                        await window.api.removeCard(item.scryfallId, item.finish, 1)
                        playUndo()
                        setMessage(`↩ Removed 1× ${item.name}`)
                        loadInventory()
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="muted">
            {dateFrom || dateTo
              ? 'Nothing scanned in this date range.'
              : 'Nothing in inventory yet.'}
          </p>
        )}
      </section>
      </div>
      )}
    </div>
  )
}
