import { useCallback, useEffect, useRef, useState } from 'react'
import CameraPanel, { type CapturedFrame } from './components/CameraPanel'
import type {
  CardRef,
  Finish,
  InventorySummary,
  RefProgress,
  RefStatus
} from '../../shared/types'

interface CapturePreview {
  frameUrl: string
  titleUrl: string
  cornerUrl: string
  width: number
  height: number
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

  const onCapture = useCallback((c: CapturedFrame) => {
    setCapture({
      frameUrl: c.frame.toDataURL('image/png'),
      titleUrl: c.title.toDataURL('image/png'),
      cornerUrl: c.corner.toDataURL('image/png'),
      width: c.width,
      height: c.height
    })
  }, [])

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
    setInputRef.current?.focus()
  }, [])

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
    setCard(found)
    if (!found.finishes.includes(finish)) setFinish(found.finishes[0] ?? 'nonfoil')
  }, [setCode, collectorNumber, finish])

  const addCard = useCallback(async () => {
    if (!card) return
    const item = await window.api.addCard(card, finish, quantity)
    setMessage(
      `Added ${item.name} (${item.setCode.toUpperCase()} #${item.collectorNumber}, ${item.finish}) — now ×${item.quantity}`
    )
    setFlash(true)
    setTimeout(() => setFlash(false), 350)
    loadInventory()
    resetForNext()
  }, [card, finish, quantity, loadInventory, resetForNext])

  // Keyboard flow: Enter = confirm, F = toggle foil, Esc = reject.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!card) return
      const inInput = (e.target as HTMLElement).tagName === 'INPUT'
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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [card, finish, addCard, resetForNext])

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
          <button onClick={() => setCameraOn((v) => !v)}>
            {cameraOn ? 'Hide camera' : 'Show camera'}
          </button>
        </div>
        {cameraOn && <CameraPanel onCapture={onCapture} />}
        {capture && (
          <div className="capture-preview">
            <p className="muted">
              Captured at {capture.width}×{capture.height} — OCR wiring lands in step 3; check
              the two crops are sharp and fully inside their boxes.
            </p>
            <div className="capture-row">
              <figure>
                <img className="capture-frame" src={capture.frameUrl} alt="captured frame" />
                <figcaption className="muted small">full frame</figcaption>
              </figure>
              <div className="capture-crops">
                <figure>
                  <img className="capture-crop" src={capture.titleUrl} alt="name region" />
                  <figcaption className="muted small">name region</figcaption>
                </figure>
                <figure>
                  <img className="capture-crop" src={capture.cornerUrl} alt="set / collector region" />
                  <figcaption className="muted small">set / collector region</figcaption>
                </figure>
                <button onClick={() => setCapture(null)}>Clear</button>
              </div>
            </div>
          </div>
        )}
      </section>

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
                        setCard(c)
                        setShowSearch(false)
                        if (!c.finishes.includes(finish)) setFinish(c.finishes[0] ?? 'nonfoil')
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
              </tr>
            </thead>
            <tbody>
              {inventory.items.slice(0, 20).map((item) => (
                <tr key={item.id}>
                  <td>×{item.quantity}</td>
                  <td>{item.name}</td>
                  <td>{item.setCode.toUpperCase()}</td>
                  <td>{item.collectorNumber}</td>
                  <td>{item.finish}</td>
                  <td>{item.rarity}</td>
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
