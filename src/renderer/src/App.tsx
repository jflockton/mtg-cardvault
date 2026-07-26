import { useCallback, useEffect, useRef, useState } from 'react'
import CameraPanel, { type CapturedFrame } from './components/CameraPanel'
import { playSuccess, playAttention, playUndo } from './scan/audio'
import type {
  CardRef,
  CornerScanResult,
  Finish,
  InventorySummary,
  RefProgress,
  RefStatus
} from '../../shared/types'

interface CapturePreview {
  cornerUrl: string
  width: number
  height: number
}

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'done'; result: CornerScanResult }
  | { status: 'error'; message: string }

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
    <section className="panel ref-panel">
      <div className="ref-row">
        <div>
          <h2>Card database</h2>
          {status?.ready ? (
            <p className="muted">
              {status.cardCount.toLocaleString()} printings · Scryfall data from{' '}
              {status.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : 'unknown'}
            </p>
          ) : (
            <p className="warn">
              No reference data yet — download it once to enable offline lookups.
            </p>
          )}
        </div>
        <button onClick={refresh} disabled={busy}>
          {busy ? 'Refreshing…' : status?.ready ? 'Refresh card data' : 'Download card data'}
        </button>
      </div>
      {progressText && (
        <div className="progress-area">
          <p className={progress?.phase === 'error' ? 'warn' : 'muted'}>{progressText}</p>
          {pct !== null && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function CardPreview({
  card,
  finish,
  setFinish,
  quantity,
  setQuantity,
  onAdd,
  onCancel
}: {
  card: CardRef
  finish: Finish
  setFinish: (f: Finish) => void
  quantity: number
  setQuantity: (n: number) => void
  onAdd: () => void
  onCancel: () => void
}): React.JSX.Element {
  const price = finish === 'nonfoil' ? card.pricesUsd : card.pricesUsdFoil
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
        {price != null && <p className="price">${price.toFixed(2)}</p>}
        <div className="action-row">
          <button className="primary" onClick={onAdd}>
            Add to inventory (Enter)
          </button>
          <button onClick={onCancel}>Cancel (Esc)</button>
        </div>
        <p className="muted small">F toggles foil</p>
      </div>
    </div>
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
      <p className="muted small">
        read: set <b>{parsed.setCode?.toUpperCase() ?? '—'}</b>
        {result.setConf != null && <> ({Math.round(result.setConf)}%)</>} · №{' '}
        <b>{parsed.number ?? '—'}</b>
        {result.numberConf != null && <> ({Math.round(result.numberConf)}%)</>}
        {parsed.total != null && <>/{parsed.total}</>} · year <b>{parsed.year ?? '—'}</b> ·{' '}
        {Math.round(confidence)}% overall · {ms} ms
      </p>
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

export default function App(): React.JSX.Element {
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
  // Lock loop state — a ref, not state: it mutates on every pumped frame.
  const auto = useRef({
    busy: false,
    lastId: null as string | null, // exact id seen on the previous frame
    hits: 0, // consecutive frames agreeing on lastId
    lockConf: 0, // lowest number-token confidence across the agreeing frames
    lastAddedId: null as string | null,
    clearFrames: 0, // frames since add that did NOT show lastAddedId
    missStreak: 0, // consecutive frames with content but no lock
    warned: false // attention beep already played this episode
  })
  const undoStack = useRef<{ scryfallId: string; finish: Finish; name: string }[]>([])

  const setInputRef = useRef<HTMLInputElement>(null)

  const loadStatus = useCallback(() => {
    window.api.refStatus().then(setRefStatus)
  }, [])
  const loadInventory = useCallback(() => {
    window.api.listInventory().then(setInventory)
  }, [])

  useEffect(() => {
    if (!window.api) return
    loadStatus()
    loadInventory()
  }, [loadStatus, loadInventory])

  const resetForNext = useCallback(() => {
    setCard(null)
    setSetCode('')
    setCollectorNumber('')
    setQuantity(1)
    setSearchResults([])
    setShowSearch(false)
    setCapture(null)
    setScan({ status: 'idle' })
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
    async (c: CardRef) => {
      // Finish decisions happen AFTER the scan (F key / row selects) — keep
      // the loop moving. Foil-only printings land on their only finish.
      const addFinish: Finish = c.finishes.includes('nonfoil')
        ? 'nonfoil'
        : (c.finishes[0] ?? 'nonfoil')
      const item = await window.api.addCard(c, addFinish, 1)
      undoStack.current.push({ scryfallId: c.scryfallId, finish: addFinish, name: c.name })
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

  /** F after a beep: cycle the just-added copy's finish (foil → etched → back). */
  const flipLastFinish = useCallback(async () => {
    const last = undoStack.current[undoStack.current.length - 1]
    if (!last) return
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
    await window.api.removeCard(last.scryfallId, last.finish, 1)
    playUndo()
    setMessage(`↩ Removed 1× ${last.name}`)
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
      if (a.busy) return
      a.busy = true
      try {
        const result = await window.api.scanCorner(c.cornerVariants)
        const res = result.resolution
        const readSomething = Boolean(result.parsed.number || result.parsed.setCode)

        // Liveness: refresh the crop thumbnail + readout on EVERY processed
        // frame, so the operator can watch the loop thinking (~2/sec).
        setCapture({
          cornerUrl: c.corner.toDataURL('image/png'),
          width: c.width,
          height: c.height
        })
        setScan({ status: 'done', result })

        if (res.kind === 'exact' && res.card) {
          const id = res.card.scryfallId
          const frameConf = result.numberConf ?? result.confidence
          a.missStreak = 0
          if (id === a.lastAddedId && a.clearFrames < 2) {
            // Same card still sitting in frame after its add — ignore until
            // we've seen it leave (2 frames without it).
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
          if (a.hits >= 2) {
            const lockConf = a.lockConf
            a.hits = 0
            a.lastId = null
            a.warned = false
            if (lockConf >= 65) {
              a.lastAddedId = id
              a.clearFrames = 0
              setAutoStatus('')
              await autoAdd(res.card)
            } else {
              // Agreeing frames but a shaky digit read (blur reads the same
              // wrong way twice) — human glance instead of a silent write.
              playAttention()
              applyCard(res.card)
              setAutoStatus(
                `low confidence (${Math.round(lockConf)}%) — check the match, Enter adds, Esc rescans`
              )
            }
          } else {
            setAutoStatus(`locking: ${res.card.name}…`)
          }
          return
        }

        // Not an exact hit on this frame — counts as "last-added card gone".
        a.lastId = null
        a.hits = 0
        a.clearFrames++

        if (res.kind === 'candidates') {
          // Needs a human tap — pause by showing the shortlist.
          playAttention()
          setAutoStatus('ambiguous — pick from the list')
          return
        }

        if (readSomething) {
          a.missStreak++
          const p = result.parsed
          setAutoStatus(
            `saw ${p.setCode?.toUpperCase() ?? '—'} #${p.number ?? '—'}${
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
        setAutoStatus(`scan error: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        auto.current.busy = false
      }
    },
    [card, autoAdd, applyCard]
  )

  const onCapture = useCallback(
    async (c: CapturedFrame, isAuto: boolean) => {
      if (isAuto) return onAutoFrame(c)
      setCapture({
        cornerUrl: c.corner.toDataURL('image/png'),
        width: c.width,
        height: c.height
      })
      setCard(null)
      setMessage(null)
      setScan({ status: 'scanning' })
      try {
        const result = await window.api.scanCorner(c.cornerVariants)
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
    [applyCard, onAutoFrame]
  )

  const addCard = useCallback(async () => {
    if (!card) return
    const item = await window.api.addCard(card, finish, quantity)
    undoStack.current.push({ scryfallId: card.scryfallId, finish, name: card.name })
    if (autoMode) {
      // Confirmed via preview during auto scan: arm the same-card cooldown
      // so the card still in frame doesn't immediately re-add.
      auto.current.lastAddedId = card.scryfallId
      auto.current.clearFrames = 0
    }
    playSuccess()
    setMessage(
      `Added ${item.name} (${item.setCode.toUpperCase()} #${item.collectorNumber}, ${item.finish}) — now ×${item.quantity}`
    )
    setFlash(true)
    setTimeout(() => setFlash(false), 350)
    loadInventory()
    resetForNext()
  }, [card, finish, quantity, autoMode, loadInventory, resetForNext])

  // Keyboard flow. Preview open: Enter = confirm, F = toggle foil, Esc =
  // reject. No preview: F = sticky finish for auto-adds, Backspace = undo
  // the last add.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
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
      if (e.key === 'f' || e.key === 'F') {
        flipLastFinish()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        undoLast()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [card, finish, addCard, resetForNext, undoLast, flipLastFinish])

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

  return (
    <div className={`app ${flash ? 'flash' : ''}`}>
      <header>
        <h1>🃏 MTG CardVault</h1>
        {inventory && (
          <p className="muted">
            {inventory.totalCards.toLocaleString()} cards ·{' '}
            {inventory.distinctStacks.toLocaleString()} stacks
          </p>
        )}
      </header>

      <ReferencePanel status={refStatus} onStatusChange={loadStatus} />

      <section className="panel">
        <div className="ref-row">
          <h2>Scan card</h2>
          <div className="toolbar-right">
            <button
              className={autoMode ? 'primary' : ''}
              onClick={() => {
                const next = !autoMode
                auto.current = {
                  busy: false,
                  lastId: null,
                  hits: 0,
                  lockConf: 0,
                  lastAddedId: null,
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
        {autoMode && (
          <div className="auto-bar">
            <span className={`auto-status ${autoStatus.startsWith('✓') ? 'ok' : ''}`}>
              {autoStatus || 'watching…'}
            </span>
            <span className="muted small">
              hold card until the beep, then next card · F = last card was foil · Backspace
              undo · Space force scan
            </span>
          </div>
        )}
        {cameraOn && <CameraPanel onCapture={onCapture} autoMode={autoMode} />}
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

      {(message || card) && (
        <section className="panel">
          <h2>Match</h2>
          {message && <p className="message">{message}</p>}
          {card && (
            <CardPreview
              card={card}
              finish={finish}
              setFinish={setFinish}
              quantity={quantity}
              setQuantity={setQuantity}
              onAdd={addCard}
              onCancel={resetForNext}
            />
          )}
        </section>
      )}

      <section className="panel">
        <h2>Add card (manual)</h2>
        <div className="lookup-row">
          <label>
            Set code
            <input
              ref={setInputRef}
              value={setCode}
              placeholder="e.g. M21"
              maxLength={6}
              onChange={(e) => setSetCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
            />
          </label>
          <label>
            Collector №
            <input
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
      </section>

      <section className="panel">
        <h2>Just added</h2>
        {inventory && inventory.items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Name</th>
                <th>Set</th>
                <th>№</th>
                <th>Finish</th>
                <th>Rarity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inventory.items.slice(0, 20).map((item) => (
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
                    <button
                      className="row-undo"
                      title="remove one"
                      onClick={async () => {
                        await window.api.removeCard(item.scryfallId, item.finish, 1)
                        playUndo()
                        setMessage(`↩ Removed 1× ${item.name}`)
                        loadInventory()
                      }}
                    >
                      −1
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nothing in inventory yet.</p>
        )}
      </section>
    </div>
  )
}
