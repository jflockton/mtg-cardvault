// Wish lists: named groups of printings the shop WANTS. Deliberately plain
// next to the deck builder — no formats, boards, curves or filters, just the
// cards on a list with their art, and an export of buyable lines.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WishlistSummary, WishlistDetail } from '../../../shared/types'

/** Ask for one line of text. Enter confirms, Esc cancels. */
function NameModal(props: {
  title: string
  initial?: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(props.initial ?? '')
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <input
          className="modal-input"
          ref={ref}
          value={name}
          placeholder="Wish list name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) props.onConfirm(name.trim())
            if (e.key === 'Escape') props.onCancel()
          }}
        />
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => props.onConfirm(name.trim())}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WishLists(): React.JSX.Element {
  const [lists, setLists] = useState<WishlistSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<WishlistDetail | null>(null)
  const [modal, setModal] = useState<'new' | 'rename' | null>(null)
  const [gbpPerEur, setGbpPerEur] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const loadLists = useCallback(() => {
    void window.api.wishList().then(setLists)
  }, [])

  const loadDetail = useCallback((id: number) => {
    void window.api.wishGet(id).then(setDetail)
  }, [])

  useEffect(() => loadLists(), [loadLists])
  useEffect(() => {
    void window.api.fxRate().then((r) => setGbpPerEur(r.gbpPerEur))
  }, [])
  useEffect(() => {
    if (openId == null) setDetail(null)
    else loadDetail(openId)
  }, [openId, loadDetail])

  // A one-line confirmation under the toolbar, cleared after a few seconds.
  const say = (msg: string): void => {
    setNote(msg)
    setTimeout(() => setNote(''), 4000)
  }

  const price = (eur: number | null): string =>
    eur == null ? '—' : gbpPerEur != null ? `£${(eur * gbpPerEur).toFixed(2)}` : `€${eur.toFixed(2)}`

  const createList = async (name: string): Promise<void> => {
    setModal(null)
    const made = await window.api.wishCreate(name)
    loadLists()
    setOpenId(made.id)
  }

  const renameList = async (name: string): Promise<void> => {
    setModal(null)
    if (openId == null) return
    await window.api.wishRename(openId, name)
    loadLists()
    loadDetail(openId)
  }

  const deleteList = async (): Promise<void> => {
    if (!detail) return
    if (!confirm(`Delete "${detail.name}" and its ${detail.cards.length} cards?`)) return
    await window.api.wishDelete(detail.id)
    setOpenId(null)
    loadLists()
  }

  const removeCard = async (rowId: number): Promise<void> => {
    await window.api.wishRemoveCard(rowId)
    if (openId != null) loadDetail(openId)
    loadLists()
  }

  const lines = (n: number): string => `${n} ${n === 1 ? 'line' : 'lines'}`

  const copyList = async (): Promise<void> => {
    if (openId == null) return
    const r = await window.api.wishExportCopy(openId)
    say(r.lines > 0 ? `Copied ${lines(r.lines)} to the clipboard.` : 'Nothing to copy yet.')
  }

  const saveList = async (): Promise<void> => {
    if (openId == null) return
    const r = await window.api.wishExportFile(openId)
    if (r.canceled) return
    say(r.ok ? `Saved ${lines(r.lines ?? 0)} to ${r.path}` : 'Could not save the file.')
  }

  // ---- one open list: its cards, with art, and nothing else
  if (openId != null && detail) {
    const totalEur = detail.cards.reduce((n, c) => n + (c.priceEur ?? 0), 0)
    return (
      <div className="section-body">
        <section className="panel">
          <div className="wish-head">
            <button onClick={() => setOpenId(null)}>← All wish lists</button>
            <h2>{detail.name}</h2>
            <span className="muted">
              {detail.cards.length} {detail.cards.length === 1 ? 'card' : 'cards'} ·{' '}
              {price(totalEur)}
            </span>
            <div className="toolbar-right">
              <button onClick={() => setModal('rename')}>✎ Rename</button>
              <button title="Name (SET) 123 lines" onClick={() => void copyList()}>
                📋 Copy list
              </button>
              <button title="Save those lines as a .txt" onClick={() => void saveList()}>
                💾 Export
              </button>
              <button className="danger" onClick={() => void deleteList()}>
                🗑 Delete list
              </button>
            </div>
          </div>
          {note && <p className="muted wish-note">{note}</p>}
          {detail.cards.length === 0 ? (
            <p className="muted">
              Nothing on this list yet. Open <b>Show Inventory</b>, click a card, and use{' '}
              <b>☆ Add to wish list</b>.
            </p>
          ) : (
            <div className="wish-cards">
              {detail.cards.map((c) => (
                <div className="wish-card" key={c.rowId}>
                  {c.imageUri ? (
                    <img src={c.imageUri} alt={c.name} loading="lazy" />
                  ) : (
                    <div className="wish-noimg">{c.name}</div>
                  )}
                  {c.owned > 0 && <span className="wish-owned">in stock ×{c.owned}</span>}
                  <button
                    className="wish-remove"
                    title="Remove from this wish list"
                    onClick={() => void removeCard(c.rowId)}
                  >
                    ✕
                  </button>
                  <div className="wish-meta">
                    <div className="wish-name">{c.name}</div>
                    <div className="muted small">
                      {c.setCode ? `${c.setCode.toUpperCase()} #${c.collectorNumber}` : '—'} ·{' '}
                      {price(c.priceEur)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        {modal === 'rename' && (
          <NameModal
            title="Rename wish list"
            initial={detail.name}
            confirmLabel="Rename"
            onConfirm={(n) => void renameList(n)}
            onCancel={() => setModal(null)}
          />
        )}
      </div>
    )
  }

  // ---- the index of lists
  return (
    <div className="section-body">
      <section className="panel">
        <div className="wish-head">
          <h2>Wish lists</h2>
          <span className="muted">Cards to buy — build a list, then export it</span>
          <div className="toolbar-right">
            <button className="primary" onClick={() => setModal('new')}>
              ✚ New wish list
            </button>
          </div>
        </div>
        {lists == null ? (
          <p className="muted">Loading…</p>
        ) : lists.length === 0 ? (
          <p className="muted">
            No wish lists yet. <b>New wish list</b> makes one — then add cards from{' '}
            <b>Show Inventory</b> with <b>☆ Add to wish list</b>.
          </p>
        ) : (
          <div className="deck-tiles">
            {lists.map((w) => (
              <button
                key={w.id}
                className={`deck-tile ${w.imageUri ? 'has-art' : ''}`}
                onClick={() => setOpenId(w.id)}
                style={w.imageUri ? { backgroundImage: `url(${w.imageUri})` } : undefined}
              >
                <span className="deck-tile-overlay">
                  <span className="deck-tile-name">{w.name}</span>
                  <span className="deck-tile-meta">
                    {w.cardCount} {w.cardCount === 1 ? 'card' : 'cards'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      {modal === 'new' && (
        <NameModal
          title="New wish list"
          confirmLabel="Create"
          onConfirm={(n) => void createList(n)}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  )
}
