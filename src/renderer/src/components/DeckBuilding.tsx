import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeckSummary, DeckDetail, DeckCard, DeckFormat } from '../../../shared/types'
import { DECK_FORMATS } from '../../../shared/types'
import {
  computeDeckStats,
  deckCategory,
  manaValue,
  CATEGORY_LABELS,
  COLORS,
  type ManaColor
} from '../../../shared/deckStats'

const COLOR_HEX: Record<ManaColor, string> = {
  W: '#e9e2c8',
  U: '#3b82f6',
  B: '#6b7280',
  R: '#ef5a3a',
  G: '#3fae63'
}

/** Render a mana cost as compact text pips: "{2}{U}{U}" → "2 U U". */
function ManaPips({ cost }: { cost: string | null }): React.JSX.Element | null {
  if (!cost) return null
  const syms = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
  if (syms.length === 0) return null
  return (
    <span className="pips">
      {syms.map((s, i) => {
        const color = (COLORS as readonly string[]).find((c) => s === c) as ManaColor | undefined
        return (
          <span
            key={i}
            className="pip"
            style={color ? { background: COLOR_HEX[color], color: '#14161a' } : undefined}
          >
            {s}
          </span>
        )
      })}
    </span>
  )
}

/** A modal that asks for one line of text (deck name). Enter confirms, Esc cancels. */
function NameModal(props: {
  title: string
  initial?: string
  confirmLabel: string
  withFormat?: boolean
  format?: DeckFormat
  onConfirm: (name: string, format: DeckFormat) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(props.initial ?? '')
  const [format, setFormat] = useState<DeckFormat>(props.format ?? 'commander')
  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <input
          autoFocus
          className="modal-input"
          value={name}
          placeholder="Deck name…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) props.onConfirm(name.trim(), format)
            if (e.key === 'Escape') props.onCancel()
          }}
        />
        {props.withFormat && (
          <label className="modal-format">
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value as DeckFormat)}>
              {DECK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => props.onConfirm(name.trim(), format)}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Paste-a-decklist modal. */
function ImportModal(props: {
  onConfirm: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Paste a decklist</h3>
        <p className="muted small">
          One card per line — e.g. <code>1 Sol Ring</code> or <code>2 Island (FIN) 297</code>.
          Section headers (Commander / Sideboard) and <code>*F*</code> foil markers are
          understood. Unknown cards are kept and flagged.
        </p>
        <textarea
          autoFocus
          className="import-textarea"
          value={text}
          placeholder={'Commander\n1 Atraxa, Praetors’ Voice\n\nDeck\n1 Sol Ring\n10 Forest'}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-actions">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" disabled={!text.trim()} onClick={() => props.onConfirm(text)}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- analysis panels

function DeckStatsPanel({ stats }: { stats: ReturnType<typeof computeDeckStats> }): React.JSX.Element {
  const totalPips = stats.colors.reduce((n, c) => n + c.pips, 0) + stats.genericPips
  return (
    <section className="panel analysis-panel">
      <h3>🎨 Colour breakdown</h3>
      <p className="muted small">
        {stats.spellCount} spells · {stats.landCount} lands
        {stats.unresolvedCount > 0 && ` · ${stats.unresolvedCount} unresolved`}
      </p>
      <div className="color-bars">
        {stats.colors.map((c) => {
          const pct = totalPips > 0 ? Math.round((c.pips / totalPips) * 100) : 0
          return (
            <div key={c.color} className="color-bar-row" title={`${c.cards} cards, ${c.pips} pips`}>
              <span className="color-chip" style={{ background: COLOR_HEX[c.color] }}>
                {c.color}
              </span>
              <div className="color-track">
                <div
                  className="color-fill"
                  style={{ width: `${pct}%`, background: COLOR_HEX[c.color] }}
                />
              </div>
              <span className="color-pct">{pct}%</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CurvePanel({ stats }: { stats: ReturnType<typeof computeDeckStats> }): React.JSX.Element {
  const max = Math.max(1, ...stats.curve.map((b) => b.count))
  return (
    <section className="panel analysis-panel">
      <h3>📈 Mana curve</h3>
      <p className="muted small">Avg mana value {stats.avgManaValue.toFixed(2)} (spells only)</p>
      <div className="curve">
        {stats.curve.map((b) => (
          <div key={b.mv} className="curve-col">
            <span className="curve-count">{b.count || ''}</span>
            <div className="curve-bar" style={{ height: `${(b.count / max) * 100}%` }} />
            <span className="curve-label">{b.mv === 7 ? '7+' : b.mv}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function OddsPanel({ stats }: { stats: ReturnType<typeof computeDeckStats> }): React.JSX.Element {
  return (
    <section className="panel analysis-panel">
      <h3>🎲 Opening hand odds</h3>
      <p className="muted small">
        Chance of ≥1 in your opening {stats.openingHand} from {stats.totalCards} cards
      </p>
      <table className="odds-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Qty</th>
            <th>≥1 in 7</th>
          </tr>
        </thead>
        <tbody>
          {stats.categories.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>{c.quantity}</td>
              <td>{Math.round(c.oddsOpening * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Click-a-card detail: big art + actions, in the spirit of Archidekt's card panel. */
function CardModal(props: {
  card: DeckCard
  gbpPerEur: number | null
  isDeckImage: boolean
  onQty: (q: number) => void
  onToggleCommander: () => void
  onSetDeckImage: () => void
  onRemove: () => void
  onClose: () => void
}): React.JSX.Element {
  const { card } = props
  const isCmd = card.category === 'commander'
  const price =
    card.priceEur != null
      ? props.gbpPerEur != null
        ? `£${(card.priceEur * props.gbpPerEur).toFixed(2)}`
        : `€${card.priceEur.toFixed(2)}`
      : card.priceUsd != null
        ? `$${card.priceUsd.toFixed(2)}`
        : '—'
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-modal-art">
          {card.imageUri ? (
            <img src={card.imageUri} alt={card.name} />
          ) : (
            <div className="card-modal-noart">
              <span className="scp-name">{card.name}</span>
              <ManaPips cost={card.manaCost} />
              <em className="muted small">not in reference DB</em>
            </div>
          )}
        </div>
        <div className="card-modal-body">
          <div className="card-modal-head">
            <h3>{card.name}</h3>
            <button className="modal-x" title="close" onClick={props.onClose}>
              ✕
            </button>
          </div>
          <p className="muted small">
            {card.typeLine ?? '—'}
            {card.setCode ? ` · ${card.setCode.toUpperCase()} #${card.collectorNumber}` : ''}
          </p>
          <p className="muted small">
            {card.owned > 0 ? `${card.owned} in inventory` : 'not in inventory'} · {price}
          </p>

          <div className="card-modal-qty">
            <span>In deck</span>
            <div className="qty-step">
              <button onClick={() => props.onQty(card.quantity - 1)}>−</button>
              <span>{card.quantity}</span>
              <button onClick={() => props.onQty(card.quantity + 1)}>+</button>
            </div>
          </div>

          <div className="card-modal-actions">
            <button className={isCmd ? 'primary' : ''} onClick={props.onToggleCommander}>
              ♛ {isCmd ? 'Unset commander' : 'Set as commander'}
            </button>
            <button
              className={props.isDeckImage ? 'primary' : ''}
              onClick={props.onSetDeckImage}
              disabled={!card.imageUri}
            >
              🖼 {props.isDeckImage ? 'Deck image ✓' : 'Set as deck image'}
            </button>
            <button className="danger" onClick={props.onRemove}>
              🗑 Remove from deck
            </button>
          </div>

          {card.scryfallId && card.setCode && (
            <a
              className="ext-link deck-scryfall"
              target="_blank"
              rel="noreferrer"
              href={`https://scryfall.com/card/${card.setCode}/${card.collectorNumber}`}
            >
              Full details on Scryfall ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- deck detail view

function DeckDetailView(props: {
  deck: DeckDetail
  gbpPerEur: number | null
  onBack: () => void
  onReload: () => void
  onRename: () => void
  onDelete: () => void
  onImport: () => void
  onCopyMissing: () => void
}): React.JSX.Element {
  const { deck, gbpPerEur } = props
  const stats = useMemo(() => computeDeckStats(deck.cards), [deck.cards])

  const totalEur = useMemo(
    () =>
      deck.cards
        .filter((c) => c.category === '' || c.category === 'commander')
        .reduce((n, c) => n + (c.priceEur ?? 0) * c.quantity, 0),
    [deck.cards]
  )
  const totalLabel =
    gbpPerEur != null ? `£${(totalEur * gbpPerEur).toFixed(2)}` : `€${totalEur.toFixed(2)}`

  // Group the card list by type category, in the canonical order.
  const groups = useMemo(() => {
    const byCat = new Map<string, DeckCard[]>()
    for (const c of deck.cards) {
      if (c.category === 'sideboard' || c.category === 'maybe') continue
      const label = c.category === 'commander' ? 'Commander' : deckCategory(c.typeLine)
      const arr = byCat.get(label) ?? []
      arr.push(c)
      byCat.set(label, arr)
    }
    const order = ['Commander', ...CATEGORY_LABELS]
    return order
      .filter((l) => byCat.has(l))
      .map((label) => ({
        label,
        cards: byCat
          .get(label)!
          .sort((a, b) => manaValue(a.manaCost) - manaValue(b.manaCost) || a.name.localeCompare(b.name)),
        count: byCat.get(label)!.reduce((n, c) => n + c.quantity, 0)
      }))
  }, [deck.cards])

  // Owned vs missing, over the main deck + commander. `owned` is copies of that
  // printing in inventory; `short` is what you'd need to buy.
  const buy = useMemo(() => {
    const inDeck = deck.cards.filter((c) => c.category === '' || c.category === 'commander')
    const missing: { card: DeckCard; short: number }[] = []
    let ownedCopies = 0
    let neededCopies = 0
    let missingEur = 0
    for (const c of inDeck) {
      neededCopies += c.quantity
      const have = Math.min(c.owned, c.quantity)
      ownedCopies += have
      const short = c.quantity - have
      if (short > 0) {
        missing.push({ card: c, short })
        missingEur += (c.priceEur ?? 0) * short
      }
    }
    return { missing, ownedCopies, neededCopies, missingEur }
  }, [deck.cards])

  const setQty = async (rowId: number, qty: number): Promise<void> => {
    await window.api.deckSetQuantity(rowId, qty)
    props.onReload()
  }

  const setCategory = async (rowId: number, category: string): Promise<void> => {
    await window.api.deckSetCategory(rowId, category)
    props.onReload()
  }

  const setDeckImage = async (uri: string | null): Promise<void> => {
    await window.api.deckSetImage(deck.id, uri)
    props.onReload()
  }

  const [openRowId, setOpenRowId] = useState<number | null>(null)
  const openCard = deck.cards.find((c) => c.rowId === openRowId) ?? null

  const priceLabel = (eur: number): string =>
    gbpPerEur != null ? `£${(eur * gbpPerEur).toFixed(2)}` : `€${eur.toFixed(2)}`

  return (
    <div className="deck-detail">
      <div className="deck-toolbar">
        <button className="link" onClick={props.onBack}>
          ← All decks
        </button>
        <h2 className="deck-title">{deck.name}</h2>
        <span className="deck-format-badge">{deck.format}</span>
        <span className="toolbar-spacer" />
        <span className="muted small">
          {stats.totalCards} cards · {totalLabel}
        </span>
        <button onClick={props.onImport}>📥 Import list</button>
        <button onClick={props.onRename}>✏ Rename</button>
        <button className="danger" onClick={props.onDelete}>
          🗑 Delete
        </button>
      </div>

      {deck.cards.length === 0 ? (
        <p className="muted">
          Empty deck. Use <b>Import list</b> to paste a decklist, or add cards from the
          inventory viewer.
        </p>
      ) : (
        <div className="deck-body">
          <div className="deck-stacks">
            {groups.map((g) => (
              <div key={g.label} className={`stack-col ${g.label === 'Commander' ? 'commander-col' : ''}`}>
                <div className="stack-head">
                  <span className="stack-label">{g.label}</span>
                  <span className="muted small">{g.count}</span>
                </div>
                <div className="stack">
                  {g.cards.map((c) => (
                    <div
                      key={c.rowId}
                      className="stack-card"
                      title={`${c.name} — click for options`}
                      onClick={() => setOpenRowId(c.rowId)}
                    >
                      {c.imageUri ? (
                        <img
                          className="stack-card-img"
                          src={c.imageUri}
                          alt={c.name}
                          loading="lazy"
                        />
                      ) : (
                        <div className="stack-card-placeholder">
                          <span className="scp-name">{c.name}</span>
                          <ManaPips cost={c.manaCost} />
                          <em className="muted small">not in reference DB</em>
                        </div>
                      )}
                      {c.quantity > 1 && <span className="stack-card-qty">{c.quantity}×</span>}
                      {c.category === 'commander' && (
                        <span className="stack-card-crown" title="commander">
                          ♛
                        </span>
                      )}
                      {c.owned > 0 && (
                        <span className="stack-card-owned" title={`${c.owned} in your inventory`} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <aside className="deck-side">
            <section className="panel buy-panel">
              <h3>🛒 Missing singles</h3>
              {buy.missing.length === 0 ? (
                <p className="muted small">You own every card in this deck. 🎉</p>
              ) : (
                <>
                  <p className="muted small">
                    {buy.missing.reduce((n, m) => n + m.short, 0)} to buy ·{' '}
                    <span className="buy-cost">{priceLabel(buy.missingEur)}</span> est.
                  </p>
                  <ul className="buy-list">
                    {buy.missing.map((m) => (
                      <li key={m.card.rowId}>
                        <span className="buy-short">{m.short}×</span>
                        <span className="buy-name">{m.card.name}</span>
                        <span className="buy-price">
                          {m.card.priceEur != null ? priceLabel(m.card.priceEur * m.short) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button className="primary" onClick={props.onCopyMissing}>
                    📋 Copy buy list
                  </button>
                </>
              )}
            </section>

            <section className="panel owned-panel">
              <h3>✅ Cards owned</h3>
              <div className="owned-meter">
                <div
                  className="owned-fill"
                  style={{
                    width: `${buy.neededCopies > 0 ? (buy.ownedCopies / buy.neededCopies) * 100 : 0}%`
                  }}
                />
              </div>
              <p className="muted small">
                {buy.ownedCopies} of {buy.neededCopies} owned
                {buy.neededCopies > 0 &&
                  ` (${Math.round((buy.ownedCopies / buy.neededCopies) * 100)}%)`}
              </p>
            </section>
          </aside>
        </div>
      )}

      <div className="deck-analysis">
        <DeckStatsPanel stats={stats} />
        <CurvePanel stats={stats} />
        <OddsPanel stats={stats} />
      </div>

      {openCard && (
        <CardModal
          card={openCard}
          gbpPerEur={gbpPerEur}
          isDeckImage={deck.imageUri != null && deck.imageUri === openCard.imageUri}
          onQty={(q) => {
            void setQty(openCard.rowId, q)
            if (q <= 0) setOpenRowId(null)
          }}
          onToggleCommander={() =>
            void setCategory(openCard.rowId, openCard.category === 'commander' ? '' : 'commander')
          }
          onSetDeckImage={() => {
            if (openCard.imageUri) {
              // toggle: clicking the current deck image clears it back to commander art
              void setDeckImage(deck.imageUri === openCard.imageUri ? null : openCard.imageUri)
            }
          }}
          onRemove={() => {
            void setQty(openCard.rowId, 0)
            setOpenRowId(null)
          }}
          onClose={() => setOpenRowId(null)}
        />
      )}
    </div>
  )
}

// --------------------------------------------------------------------- root

export default function DeckBuilding(): React.JSX.Element {
  const [decks, setDecks] = useState<DeckSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<DeckDetail | null>(null)
  const [gbpPerEur, setGbpPerEur] = useState<number | null>(null)
  const [modal, setModal] = useState<'new' | 'rename' | 'import' | null>(null)
  const [message, setMessage] = useState('')

  const loadDecks = useCallback(() => {
    void window.api.deckList().then(setDecks)
  }, [])

  const loadDetail = useCallback((id: number) => {
    void window.api.deckGet(id).then(setDetail)
  }, [])

  useEffect(() => {
    loadDecks()
    void window.api.fxRate().then((r) => setGbpPerEur(r.gbpPerEur))
  }, [loadDecks])

  useEffect(() => {
    if (openId != null) loadDetail(openId)
    else setDetail(null)
  }, [openId, loadDetail])

  const createDeck = async (name: string, format: DeckFormat): Promise<void> => {
    const deck = await window.api.deckCreate(name, format)
    setModal(null)
    loadDecks()
    setOpenId(deck.id)
  }

  const doImport = async (text: string): Promise<void> => {
    if (openId == null) return
    const res = await window.api.deckImportText(openId, text)
    setModal(null)
    loadDetail(openId)
    loadDecks()
    setMessage(
      `Imported ${res.added} cards` +
        (res.missing.length > 0 ? ` · ${res.missing.length} unresolved (kept & flagged)` : '')
    )
  }

  const renameDeck = async (name: string): Promise<void> => {
    if (openId == null) return
    await window.api.deckRename(openId, name)
    setModal(null)
    loadDetail(openId)
    loadDecks()
  }

  const deleteDeck = async (): Promise<void> => {
    if (openId == null || !detail) return
    if (!window.confirm(`Delete "${detail.name}"? This cannot be undone.`)) return
    await window.api.deckDelete(openId)
    setOpenId(null)
    loadDecks()
  }

  const copyMissing = async (): Promise<void> => {
    if (openId == null) return
    const res = await window.api.deckCopyMissing(openId)
    setMessage(
      res.lines > 0
        ? `Copied ${res.lines} missing cards to the clipboard`
        : 'Nothing missing — you own the whole deck'
    )
  }

  return (
    <div className="section-body deck-wrap">
      {message && (
        <p className="message" onAnimationEnd={() => setMessage('')}>
          {message}
        </p>
      )}

      {detail && openId != null ? (
        <DeckDetailView
          deck={detail}
          gbpPerEur={gbpPerEur}
          onBack={() => setOpenId(null)}
          onReload={() => loadDetail(openId)}
          onRename={() => setModal('rename')}
          onDelete={deleteDeck}
          onImport={() => setModal('import')}
          onCopyMissing={() => void copyMissing()}
        />
      ) : (
        <section className="panel">
          <div className="deck-toolbar">
            <h2>Decks</h2>
            <span className="toolbar-spacer" />
            <button className="primary" onClick={() => setModal('new')}>
              ✚ New deck
            </button>
          </div>
          {decks == null ? (
            <p className="muted">Loading…</p>
          ) : decks.length === 0 ? (
            <p className="muted">
              No decks yet. <b>New deck</b> creates one — then paste a list or add cards from
              the inventory.
            </p>
          ) : (
            <div className="deck-tiles">
              {decks.map((d) => (
                <button
                  key={d.id}
                  className={`deck-tile ${d.imageUri ? 'has-art' : ''}`}
                  onClick={() => setOpenId(d.id)}
                  style={d.imageUri ? { backgroundImage: `url(${d.imageUri})` } : undefined}
                >
                  <span className="deck-tile-overlay">
                    <span className="deck-tile-name">{d.name}</span>
                    <span className="deck-tile-meta">
                      {d.format} · {d.cardCount} cards
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {modal === 'new' && (
        <NameModal
          title="New deck"
          confirmLabel="Create"
          withFormat
          onConfirm={createDeck}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'rename' && detail && (
        <NameModal
          title="Rename deck"
          initial={detail.name}
          confirmLabel="Rename"
          onConfirm={(name) => void renameDeck(name)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'import' && (
        <ImportModal onConfirm={(t) => void doImport(t)} onCancel={() => setModal(null)} />
      )}
    </div>
  )
}
