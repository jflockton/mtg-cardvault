// "Show Inventory" browser viewer: a tiny HTTP server bound to 127.0.0.1
// serving one self-contained page + JSON endpoints over the DataStore.
// Loopback-only on an ephemeral port — no firewall prompts, no CORS.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchCardFacesLive } from './refdb'
import type { DataStore, ViewerSort } from './store'
import type { Finish } from '../shared/types'
// Inlined art: Gwen badges the page header, Spidey rides the menu button.

let server: http.Server | null = null
let baseUrl: string | null = null

// EUR→GBP at the ECB daily rate — Cardmarket prices are euro-native; their
// site's GBP display is a conversion too. Cached half a day; offline → null
// and the page falls back to showing €.
let fx: { rate: number; asOf: string; fetchedAt: number } | null = null

export async function gbpRate(): Promise<{ gbpPerEur: number | null; asOf: string | null }> {
  if (fx && Date.now() - fx.fetchedAt < 12 * 60 * 60 * 1000) {
    return { gbpPerEur: fx.rate, asOf: fx.asOf }
  }
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=GBP', {
      signal: AbortSignal.timeout(4000)
    })
    if (res.ok) {
      const data = (await res.json()) as { date: string; rates: { GBP?: number } }
      if (data.rates?.GBP) {
        fx = { rate: data.rates.GBP, asOf: data.date, fetchedAt: Date.now() }
        return { gbpPerEur: fx.rate, asOf: fx.asOf }
      }
    }
  } catch {
    // offline / timeout — fall through
  }
  return fx ? { gbpPerEur: fx.rate, asOf: fx.asOf } : { gbpPerEur: null, asOf: null }
}

/** Start (or reuse) the viewer server; resolves to its URL. */
/** Shared filter-param parsing for /api/cards and /api/sets. */
function viewerFilterParams(url: URL): {
  name: string
  type: string
  subtype: string
  rarities: string[]
  commander: boolean
  foil: boolean
  colors: string[]
  colorMode: 'any' | 'only' | 'exact'
  mvMin: number | null
  mvMax: number | null
  valMin: number | null
  valMax: number | null
  fullArt: boolean
  borderless: boolean
  sort: ViewerSort
} {
  const num = (k: string): number | null => {
    const v = url.searchParams.get(k)
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null
  }
  const rawMode = url.searchParams.get('colorMode')
  const mode = rawMode === 'any' || rawMode === 'exact' ? rawMode : 'only'
  const SORTS = ['auto', 'name', 'value-desc', 'value-asc', 'mv-asc', 'mv-desc'] as const
  const rawSort = url.searchParams.get('sort') ?? 'auto'
  const sort = (SORTS as readonly string[]).includes(rawSort) ? (rawSort as ViewerSort) : 'auto'
  return {
    name: url.searchParams.get('name') ?? '',
    type: url.searchParams.get('type') ?? '',
    subtype: url.searchParams.get('subtype') ?? '',
    rarities: (url.searchParams.get('rarities') ?? '').split(',').filter(Boolean),
    commander: url.searchParams.get('commander') === '1',
    foil: url.searchParams.get('foil') === '1',
    colors: (url.searchParams.get('colors') ?? '').split(',').filter(Boolean),
    colorMode: mode,
    mvMin: num('mvMin'),
    mvMax: num('mvMax'),
    valMin: num('valMin'),
    valMax: num('valMax'),
    fullArt: url.searchParams.get('fullArt') === '1',
    borderless: url.searchParams.get('borderless') === '1',
    sort
  }
}

export function openInventoryViewer(store: DataStore): Promise<string> {
  if (server && baseUrl) return Promise.resolve(baseUrl)

  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(PAGE)
        } else if (url.pathname === '/api/inventory') {
          json(res, store.viewerInventory())
        } else if (url.pathname === '/api/cards') {
          json(
            res,
            store.viewerSearch(
              url.searchParams.get('name') ?? '',
              url.searchParams.get('set') ?? '',
              300,
              Number(url.searchParams.get('offset') ?? 0),
              viewerFilterParams(url)
            )
          )
        } else if (url.pathname === '/api/sets') {
          json(
            res,
            store.viewerSets(
              url.searchParams.get('mode') === 'all' ? 'all' : 'inventory',
              viewerFilterParams(url)
            )
          )
        } else if (url.pathname === '/api/stamp') {
          // Polled by the page so an open viewer picks up cards scanned in
          // (or sold) while it was on screen, without a manual reload.
          json(res, { stamp: store.inventoryStamp() })
        } else if (url.pathname === '/api/rate') {
          void gbpRate().then((r) => json(res, r))
        } else if (url.pathname === '/api/adjust') {
          const ok = store.viewerAdjust(
            url.searchParams.get('id') ?? '',
            (url.searchParams.get('finish') ?? 'nonfoil') as Finish,
            Number(url.searchParams.get('delta') ?? 0)
          )
          json(res, { ok })
        } else if (url.pathname === '/api/faces') {
          // Back-face art for a printing the reference DB predates — resolved
          // live once, then cached in the DB (see DataStore.cardFaces).
          void cardBackImage(store, url.searchParams.get('id') ?? '').then((backImageUri) =>
            json(res, { backImageUri })
          )
        } else if (url.pathname === '/api/decks') {
          json(res, store.listDecks())
        } else if (url.pathname === '/api/deck-add') {
          const deckId = Number(url.searchParams.get('deckId'))
          const sid = url.searchParams.get('id') ?? ''
          const qty = Number(url.searchParams.get('qty') ?? 1)
          if (deckId && sid) {
            store.addCardToDeck(deckId, sid, qty > 0 ? qty : 1)
            json(res, { ok: true })
          } else {
            json(res, { ok: false })
          }
        } else if (url.pathname === '/api/deck-create') {
          json(res, store.createDeck(url.searchParams.get('name') ?? 'Untitled deck'))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end('{"error":"not found"}')
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      server = srv
      const port = (srv.address() as AddressInfo).port
      baseUrl = `http://127.0.0.1:${port}/`
      resolve(baseUrl)
    })
  })
}

export function closeInventoryViewer(): void {
  server?.close()
  server = null
  baseUrl = null
}

/**
 * The back face of a printing, or null if it's an ordinary one-sided card.
 * Answered from the reference DB; only a DB built before the face columns
 * existed falls through to Scryfall, and that answer is cached back into the
 * DB so it costs one call per card, ever. Offline → null, no flip offered.
 */
async function cardBackImage(store: DataStore, scryfallId: string): Promise<string | null> {
  if (!scryfallId) return null
  const cached = store.cardFaces(scryfallId)
  if (cached.known) return cached.backImageUri
  try {
    const live = await fetchCardFacesLive(scryfallId)
    if (!live) return null
    store.recordCardFaces(scryfallId, live.layout, live.backImageUri)
    return live.backImageUri
  } catch {
    return null
  }
}

function json(res: http.ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MTG CardVault — Collection</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #17141f; --panel: #221e2e; --line: #37324a;
    --text: #e8e5f2; --dim: #9b95b0; --accent: #e01f2f; --gold: #d8b64a;
  }
  * { box-sizing: border-box; }
  /* Neutral grey scrollbars — the accent colour was too loud. */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #3a3746; border-radius: 6px;
    border: 3px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: #4d4a5c; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { position: sticky; top: 0; z-index: 5; background: var(--panel);
           border-bottom: 1px solid var(--line); padding: 12px 18px;
           display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  header h1 { font-size: 16px; margin: 0 12px 0 0; white-space: nowrap; }
  header h1 span { color: var(--accent); }
  input[type=search] { flex: 1 1 220px; max-width: 420px; padding: 8px 12px;
    border-radius: 8px; border: 1px solid var(--line); background: var(--bg);
    color: var(--text); font-size: 14px; outline: none; }
  input[type=search]:focus { border-color: var(--accent); }
  select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-size: 13px; max-width: 300px; }
  .tick { display: flex; align-items: center; gap: 7px; color: var(--dim);
          white-space: nowrap; cursor: pointer; user-select: none; }
  .tick input { accent-color: var(--accent); width: 16px; height: 16px; }
  .totals { margin-left: auto; color: var(--dim); white-space: nowrap; }
  .totals b { color: var(--gold); }
  #status { padding: 10px 18px 0; color: var(--dim); }
  #pager { display: none; align-items: center; gap: 12px; padding: 8px 18px 0;
    color: var(--dim); font-size: 13px; }
  #pager button { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-weight: 700; cursor: pointer; }
  #pager button:hover:not(:disabled) { border-color: var(--accent); }
  #pager button:disabled { opacity: 0.3; cursor: default; }
  #grid { display: grid; gap: 14px; padding: 14px 18px 40px;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
          overflow: hidden; cursor: pointer; position: relative;
          transition: transform .08s ease, border-color .08s ease; }
  .card:hover { transform: translateY(-2px); border-color: var(--accent); }
  .card img { width: 100%; aspect-ratio: 488/680; object-fit: cover; display: block;
              background: #0d0b12; }
  .card .noimg { width: 100%; aspect-ratio: 488/680; display: flex; align-items: center;
    justify-content: center; text-align: center; padding: 12px; color: var(--dim);
    font-size: 13px; background: #0d0b12; }
  .card .meta { padding: 8px 10px; }
  .card .nm { font-weight: 600; font-size: 13px; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
  .card .st { color: var(--dim); font-size: 12px; }
  .card .pr { font-size: 12px; margin-top: 2px; }
  .pr .eur { color: var(--gold); font-weight: 600; }
  .pr .usd { color: var(--dim); margin-left: 6px; }
  .badge { position: absolute; top: 6px; left: 6px; background: rgba(13,11,18,.85);
    border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px;
    font-size: 12px; font-weight: 700; }
  .badge.own { left: auto; right: 6px; border-color: var(--gold); color: var(--gold); }
  .badge.foil { top: 32px; color: #9ad1ff; }
  .badge.fullart { top: 58px; color: #ffd479; border-color: #ffd479; }
  .badge.borderless { top: 84px; color: #c8a2ff; border-color: #c8a2ff; }
  #overlay { position: fixed; inset: 0; background: rgba(10,8,14,.82); display: none;
    align-items: center; justify-content: center; z-index: 20; padding: 24px; }
  #overlay.show { display: flex; }
  #big { display: flex; gap: 22px; max-width: 900px; max-height: 92vh; align-items: center;
         position: relative; }
  #big img { height: min(80vh, 640px); border-radius: 18px;
             box-shadow: 0 12px 60px rgba(0,0,0,.6); }
  .zoom-wrap { overflow: hidden; border-radius: 18px; cursor: zoom-in; line-height: 0;
    perspective: 1800px; }
  .zoom-wrap img { display: block; }
  .zoom-wrap.zoomed { cursor: zoom-out; }
  /* The art sits on a 3D stage so a two-sided card can turn over in place.
     One-sided cards get the same stage with a single face — the zoom then has
     one element to scale either way. */
  .flipper { position: relative; transform-style: preserve-3d;
    transition: transform .15s ease; }
  .flipper .face { backface-visibility: hidden; }
  .flipper .back { position: absolute; top: 0; left: 0; transform: rotateY(180deg); }
  /* Only the flip itself gets the slow, weighted turn; zooming stays snappy. */
  .flipper.turning { transition: transform .72s cubic-bezier(.22,.72,.24,1); }
  .flipper.flipped { transform: rotateY(180deg); }
  .zoom-wrap.zoomed .flipper { transform: scale(2.4); }
  .zoom-wrap.zoomed .flipper.flipped { transform: scale(2.4) rotateY(180deg); }
  /* Art column: the card, with its flip button directly beneath it. */
  .art { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .flip-btn { display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 16px; border: 1px solid var(--gold); border-radius: 8px;
    background: rgba(216,182,74,.12); color: var(--text); font-weight: 700;
    font-size: 13px; cursor: pointer; }
  .flip-btn:hover { background: rgba(216,182,74,.26); }
  .flip-btn .turn { font-size: 15px; line-height: 1; }
  #big .info { max-width: 300px; }
  #big h2 { margin: 0 0 6px; font-size: 20px; }
  #big .st { color: var(--dim); margin-bottom: 12px; }
  #big .prices div { margin: 4px 0; }
  #big .prices .eur { color: var(--gold); font-weight: 700; font-size: 17px; }
  #big .own { margin-top: 12px; color: var(--gold); }
  .ext-link { display: inline-block; margin-top: 14px; padding: 7px 14px;
    border: 1px solid var(--line); border-radius: 8px; color: var(--text);
    text-decoration: none; font-weight: 700; font-size: 13px; }
  .ext-link:hover { border-color: var(--accent); }
  .banner { background: #4b1620; color: #ffd7dc; padding: 10px 18px; display: none; }
  #filterbar { display: flex; gap: 10px; align-items: center; padding: 8px 18px 0;
    flex-wrap: wrap; }
  #filterbar .lbl { color: var(--dim); font-size: 13px; white-space: nowrap; }
  #filterbar input { padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-size: 13px; outline: none;
    flex: 0 0 auto; width: 240px; max-width: 240px; }
  #subtypeFilter { width: 190px; max-width: 190px; }
  #typeSel { padding: 6px 10px; font-size: 13px; }
  #filterbar input:focus { border-color: var(--accent); }
  .chip { padding: 5px 13px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--bg); color: var(--dim); cursor: pointer; font-size: 12.5px;
    font-weight: 600; white-space: nowrap; }
  .chip:hover { border-color: var(--dim); }
  .chip.on { border-color: var(--accent); color: var(--text); background: #2d1b2e; }
  .chip-sep { width: 1px; height: 22px; background: var(--line); }
  #clearFilters { display: none; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--accent); background: var(--bg); color: var(--text); font-weight: 700; }
  .color-chip { padding: 4px 8px; font-size: 14px; line-height: 1; }
  .color-chip.on { background: #2d1b2e; }
  #colorMode { padding: 6px 8px; font-size: 12.5px; }
  #filterbar #mvMin, #filterbar #mvMax { width: 58px; max-width: 58px; padding: 6px 8px; }
  #filterbar #valMin, #filterbar #valMax { width: 72px; max-width: 72px; padding: 6px 8px; }
  #sortSel { padding: 6px 8px; font-size: 12.5px; }
  .card.owned { border-color: #3fae5c; }
  .close-x { position: absolute; top: -48px; left: 0; width: 38px; height: 38px;
    border-radius: 50%; background: rgba(13, 11, 18, 0.65); color: #fff;
    border: 1px solid var(--line); font-size: 19px; line-height: 1; cursor: pointer; }
  .close-x:hover { border-color: #fff; }
  .face-badge svg { width: 44px; height: 44px; border-radius: 10px; display: block; }
  .menu-btn { display: flex; align-items: center; gap: 8px; padding: 7px 12px;
    border-radius: 8px; border: 1px solid var(--line); background: var(--bg);
    color: var(--text); cursor: pointer; font-weight: 700; white-space: nowrap; }
  .menu-btn:hover { border-color: var(--accent); }
  .menu-btn svg { width: 22px; height: 22px; border-radius: 6px; }
  .stock-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
  .stock-row .fin { width: 62px; color: var(--dim); }
  .adj { width: 34px; height: 30px; font-weight: 800; font-size: 16px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); cursor: pointer; }
  .adj:hover:not(:disabled) { border-color: var(--accent); }
  .adj:disabled { opacity: 0.3; cursor: default; }
  @media (max-width: 700px) { #big { flex-direction: column; } #big img { height: 52vh; } }
  .add-deck-btn { display: inline-block; margin: 14px 0 0 10px; padding: 7px 14px;
    border: 1.5px solid var(--accent); border-radius: 8px; background: rgba(79,142,247,.14);
    color: var(--text); font-weight: 700; font-size: 13px; cursor: pointer; }
  .add-deck-btn:hover { background: rgba(79,142,247,.28); }
  .ctx-menu { position: fixed; z-index: 9999; display: none; min-width: 230px; max-height: 62vh;
    overflow-y: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 6px; box-shadow: 0 12px 40px rgba(0,0,0,.6); }
  .ctx-title { font-size: 12px; color: var(--dim); padding: 4px 8px 6px; }
  .ctx-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0;
    border-radius: 7px; background: none; color: var(--text); cursor: pointer; font-size: 13px; }
  .ctx-item:hover { background: var(--bg); }
  .ctx-item.new { color: var(--accent); font-weight: 700; }
  .ctx-empty { padding: 6px 10px; color: var(--dim); font-size: 12px; }
  .ctx-newdeck { display: flex; gap: 6px; padding: 4px; }
  .ctx-input { flex: 1; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-size: 13px; outline: none; }
  .ctx-input:focus { border-color: var(--accent); }
  #toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%) translateY(20px);
    background: var(--panel); border: 1px solid var(--accent); color: var(--text); padding: 10px 18px;
    border-radius: 10px; font-weight: 600; opacity: 0; pointer-events: none; transition: all .2s;
    z-index: 10000; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<header>
  <input id="q" type="search" placeholder="Type a card name…" autofocus>
  <select id="set"><option value="">All sets</option></select>
  <label class="tick"><input id="inv" type="checkbox" checked> In my inventory</label>
  <div class="totals" id="totals"></div>
</header>
<div id="filterbar">
  <span class="lbl">Filter sets:</span>
  <input id="setFilter" type="search" placeholder="type part of a set name or code…">
  <span class="lbl">Card type:</span>
  <select id="typeSel">
    <option value="">Any type</option>
    <option>Creature</option><option>Instant</option><option>Sorcery</option>
    <option>Enchantment</option><option>Artifact</option><option>Land</option>
    <option>Planeswalker</option><option>Battle</option><option>Token</option>
  </select>
  <input id="subtypeFilter" type="search" list="subtypeList"
         placeholder="subtype, e.g. Villain…" style="display:none">
  <datalist id="subtypeList"></datalist>
  <span class="chip-sep"></span>
  <button class="chip" data-rarity="common">Common</button>
  <button class="chip" data-rarity="uncommon">Uncommon</button>
  <button class="chip" data-rarity="rare">Rare</button>
  <button class="chip" data-rarity="mythic">Mythic</button>
  <span class="chip-sep"></span>
  <button class="chip" id="chipCommander">Commander</button>
  <button class="chip" id="chipFoil">Foil</button>
  <button class="chip" id="chipFullArt" title="Full-art printings only (e.g. full-art basic lands, textless promos)">Full art</button>
  <button class="chip" id="chipBorderless" title="Borderless printings only — the art runs to the card edge with no black border">Borderless</button>
  <span class="chip-sep"></span>
  <button class="chip color-chip" data-color="W" title="White">⚪</button>
  <button class="chip color-chip" data-color="U" title="Blue">🔵</button>
  <button class="chip color-chip" data-color="B" title="Black">⚫</button>
  <button class="chip color-chip" data-color="R" title="Red">🔴</button>
  <button class="chip color-chip" data-color="G" title="Green">🟢</button>
  <button class="chip color-chip" data-color="C" title="Colourless spells (never lands — use the type filter for those)">◇</button>
  <select id="colorMode" title="Only these: W+U shows white, blue, and white-blue cards (◇ adds colourless). Any of: at least one picked colour. Exactly: precisely those colours.">
    <option value="only" selected>Only these</option>
    <option value="any">Any of</option>
    <option value="exact">Exactly</option>
  </select>
  <span class="lbl" title="Mana value of the printed cost">Mana cost:</span>
  <input id="mvMin" type="number" min="0" max="20" placeholder="min">
  <span class="lbl">–</span>
  <input id="mvMax" type="number" min="0" max="20" placeholder="max">
  <span class="lbl" id="valLbl" title="Cardmarket value per card">Value £:</span>
  <input id="valMin" type="number" min="0" step="0.01" placeholder="min">
  <span class="lbl">–</span>
  <input id="valMax" type="number" min="0" step="0.01" placeholder="max">
  <span class="lbl">Sort:</span>
  <select id="sortSel" title="Applies to whatever the filters have left on screen">
    <option value="auto" selected>Default (name / set order)</option>
    <option value="value-desc">Value: high → low</option>
    <option value="value-asc">Value: low → high</option>
    <option value="mv-asc">Mana cost: low → high</option>
    <option value="mv-desc">Mana cost: high → low</option>
    <option value="name">Name A–Z</option>
  </select>
  <button id="clearFilters">✕ Clear filters</button>
</div>
<div class="banner" id="banner">Can’t reach MTG CardVault — is the app still running? Reopen this page from the app.</div>
<div id="status"></div>
<div id="pager">
  <button id="prevPage">‹ Prev</button>
  <span id="pageInfo"></span>
  <button id="nextPage">Next ›</button>
</div>
<div id="grid"></div>

<div id="overlay"><div id="big"></div></div>
<div id="deckMenu" class="ctx-menu"></div>
<div id="toast"></div>

<script>
'use strict';
const $ = (id) => document.getElementById(id);
const q = $('q'), setSel = $('set'), inv = $('inv'), grid = $('grid'),
      totals = $('totals'), status = $('status'), overlay = $('overlay'), big = $('big');
let inventory = null;   // cached /api/inventory payload
let cards = [];         // currently displayed cards
let debounce = 0;
let fxRate = null, fxAsOf = null;  // EUR→GBP (ECB); null → show native €
const PAGE_SIZE = 300;
let page = 0;          // any-card mode pagination
let totalResults = 0;  // server-side total before chip filtering

const eur = (v) => v == null ? null : '€' + v.toFixed(2);
const usd = (v) => v == null ? null : '$' + v.toFixed(2);
const gbp = (v) => (v == null || !fxRate) ? null : '£' + (v * fxRate).toFixed(2);
// Cardmarket display price: pounds when we have today's rate, else native euros.
const cm = (v) => gbp(v) ?? eur(v);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

async function api(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status);
    $('banner').style.display = 'none';
    return await r.json();
  } catch (e) {
    $('banner').style.display = 'block';
    throw e;
  }
}

let setsCache = [];
let setFilterText = '';
const activeRarities = new Set();
let wantCommander = false;
let wantFoil = false;
let wantFullArt = false;
let wantBorderless = false;
let selectedType = '';
let subtypeText = '';
const activeColors = new Set();  // W/U/B/R/G + 'C' (colourless)
let colorMode = 'only';          // only (default) | any | exact
let mvMinVal = '';
let mvMaxVal = '';
let valMinVal = '';   // as typed: £ when we have a rate, else €
let valMaxVal = '';
let sortBy = 'auto';

// The value boxes are typed in the displayed currency; everything downstream
// (this page's comparisons and the server's SQL) works in Cardmarket euros.
const toEur = (v) => (fxRate ? v / fxRate : v);

// Mana value from a "{2}{U}{U}" cost — mirrors the app's shared parser.
function manaValueOf(cost) {
  let n = 0;
  (cost || '').replace(/\\{([^}]+)\\}/g, (_, s) => {
    if (/^\\d+$/.test(s)) n += Number(s);
    else {
      const d = s.match(/\\d+/);
      if (d) n += Number(d[0]);
      else if (!/^[XYZ]$/.test(s)) n += 1;
    }
    return '';
  });
  return n;
}

function colorMatch(c) {
  if (activeColors.size === 0) return true;
  const cols = c.colors || [];
  const picked = [...activeColors].filter((x) => x !== 'C');
  // Lands have an empty colour list in the data — the ◇ chip means colourless
  // SPELLS, so lands never match a colour filter (use the type filter for lands).
  const isLand = (c.typeLine || '').includes('Land');
  if (colorMode === 'any') {
    return picked.some((x) => cols.includes(x)) ||
      (activeColors.has('C') && cols.length === 0 && !isLand);
  }
  if (colorMode === 'exact') {
    if (picked.length === 0) return cols.length === 0 && !isLand;
    return picked.every((x) => cols.includes(x)) && cols.every((x) => picked.includes(x));
  }
  // only: W+U = white, blue, or white-blue; colourless (non-land) needs ◇ too
  if (picked.length === 0) return cols.length === 0 && !isLand; // ◇ alone
  if (cols.length === 0) return activeColors.has('C') && !isLand;
  return cols.every((x) => picked.includes(x));
}

function mvMatch(c) {
  if (mvMinVal === '' && mvMaxVal === '') return true;
  const v = manaValueOf(c.manaCost);
  if (mvMinVal !== '' && v < Number(mvMinVal)) return false;
  if (mvMaxVal !== '' && v > Number(mvMaxVal)) return false;
  return true;
}

/**
 * Value band, in the same Cardmarket price the tile displays (foil price when
 * the only copies owned are foils). A card with no price can't be inside a
 * band, so it drops out — matching the server-side rule for any-card mode.
 */
function valMatch(c) {
  if (valMinVal === '' && valMaxVal === '') return true;
  const v = cardPrice(c).eur;
  if (v == null) return false;
  if (valMinVal !== '' && v < toEur(Number(valMinVal))) return false;
  if (valMaxVal !== '' && v > toEur(Number(valMaxVal))) return false;
  return true;
}

// Sort comparators: a missing price/cost always sinks to the bottom, whichever
// direction is picked, so the top of the list is never a wall of blanks.
function cmpNum(a, b, desc) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return desc ? b - a : a - b;
}

/** Sort the on-screen cards (inventory mode); any-card mode sorts in SQL. */
function sortCards(arr, setPicked) {
  const val = (c) => cardPrice(c).eur;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const byCollector = (a, b) =>
    ((parseInt(a.collectorNumber, 10) || 0) - (parseInt(b.collectorNumber, 10) || 0)) ||
    a.collectorNumber.localeCompare(b.collectorNumber);
  const out = [...arr];
  switch (sortBy) {
    case 'value-desc': return out.sort((a, b) => cmpNum(val(a), val(b), true) || byName(a, b));
    case 'value-asc':  return out.sort((a, b) => cmpNum(val(a), val(b), false) || byName(a, b));
    case 'mv-asc':     return out.sort((a, b) =>
      manaValueOf(a.manaCost) - manaValueOf(b.manaCost) || byName(a, b));
    case 'mv-desc':    return out.sort((a, b) =>
      manaValueOf(b.manaCost) - manaValueOf(a.manaCost) || byName(a, b));
    case 'name':       return out.sort(byName);
    // Default: collector order inside a chosen set, otherwise the name order
    // the collection already comes back in.
    default: return setPicked ? out.sort(byCollector) : out;
  }
}

function typeSection(line) {
  return (line || '').split('//').map((p) => p.split('—')[0]).join(' ');
}
function subtypeSection(line) {
  return (line || '').split('//').map((p) => p.split('—')[1] || '').join(' ');
}

function typeMatch(c) {
  if (selectedType &&
      !typeSection(c.typeLine).toLowerCase().includes(selectedType.toLowerCase())) return false;
  const t = subtypeText.trim().toLowerCase();
  if (t) {
    const subs = subtypeSection(c.typeLine).toLowerCase();
    if (!t.split(',').map((s) => s.trim()).filter(Boolean)
        .some((term) => subs.includes(term))) return false;
  }
  return true;
}

/**
 * The subtype combo appears only when the chosen type has subtypes among
 * the cards on screen; its suggestions come from those cards, most
 * common first — so Villain/Hero/Spider surface automatically.
 */
function rebuildSubtypes() {
  const box = $('subtypeFilter');
  if (!selectedType) { box.style.display = 'none'; return; }
  const pool = (inv.checked && inventory ? inventory.cards : cards) || [];
  const counts = new Map();
  pool.forEach((c) => {
    if (!typeSection(c.typeLine).toLowerCase().includes(selectedType.toLowerCase())) return;
    (subtypeSection(c.typeLine).match(/[A-Za-z'’-]+/g) || []).forEach((w) => {
      counts.set(w, (counts.get(w) || 0) + 1);
    });
  });
  if (counts.size === 0) { box.style.display = 'none'; return; }
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
  $('subtypeList').innerHTML = words.map(([w]) =>
    '<option value="' + esc(w) + '">').join('');
  box.style.display = 'inline-block';
}

/** Chip filters, applied on top of search + set in both modes. */
function chipMatch(c) {
  if (!typeMatch(c)) return false;
  if (!colorMatch(c) || !mvMatch(c) || !valMatch(c)) return false;
  if (activeRarities.size > 0 && !activeRarities.has(c.rarity)) return false;
  if (wantCommander && !(c.typeLine || '').includes('Legendary Creature')) return false;
  if (wantFoil) {
    const foil = inv.checked
      ? c.stacks.some((s) => s.finish !== 'nonfoil')
      : (c.priceEurFoil != null || c.priceUsdFoil != null);
    if (!foil) return false;
  }
  if (wantFullArt && !c.fullArt) return false;
  if (wantBorderless && !c.borderless) return false;
  return true;
}

function chipsActive() {
  return activeRarities.size > 0 || wantCommander || wantFoil || wantFullArt || wantBorderless ||
    selectedType !== '' || subtypeText.trim() !== '' ||
    activeColors.size > 0 || mvMinVal !== '' || mvMaxVal !== '' ||
    valMinVal !== '' || valMaxVal !== '' || sortBy !== 'auto';
}
const setFilterInput = $('setFilter');
const clearBtn = $('clearFilters');

// Set names are full of punctuation ("Marvel's Spider-Man", "Assassin's Creed"),
// so match on letters and digits only and let the words come in any order:
// "spiderman", "spider man" and "marvel spider" all find the same set.
const normSet = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function renderSetOptions() {
  const terms = setFilterText.trim().split(/\s+/).map(normSet).filter(Boolean);
  const shown = terms.length
    ? setsCache.filter((s) => {
        const name = normSet(s.name), code = normSet(s.code);
        return terms.every((t) => name.includes(t) || code.includes(t));
      })
    : setsCache;
  const keep = setSel.value;
  setSel.innerHTML = '<option value="">All sets</option>' + shown.map((s) =>
    '<option value="' + esc(s.code) + '">' + esc(s.name) + ' (' + s.code.toUpperCase() + ')' +
    (s.count ? ' — ' + s.count : '') + '</option>').join('');
  if ([...setSel.options].some((o) => o.value === keep)) {
    setSel.value = keep;
  } else if (keep) {
    setSel.insertAdjacentHTML('beforeend',
      '<option value="' + esc(keep) + '">' + esc(keep.toUpperCase()) + ' (no matches)</option>');
    setSel.value = keep;
  }
  updateClear();
}

function updateClear() {
  clearBtn.style.display =
    (setFilterText || setSel.value || chipsActive()) ? 'inline-block' : 'none';
}

/** The filter state as query params, shared by /api/sets and /api/cards. */
function filterQuery() {
  return '&type=' + encodeURIComponent(selectedType) +
    '&subtype=' + encodeURIComponent(subtypeText) +
    '&rarities=' + encodeURIComponent([...activeRarities].join(',')) +
    (wantCommander ? '&commander=1' : '') +
    (wantFoil ? '&foil=1' : '') +
    (wantFullArt ? '&fullArt=1' : '') +
    (wantBorderless ? '&borderless=1' : '') +
    '&colors=' + [...activeColors].join(',') + '&colorMode=' + colorMode +
    (mvMinVal !== '' ? '&mvMin=' + mvMinVal : '') +
    (mvMaxVal !== '' ? '&mvMax=' + mvMaxVal : '') +
    (valMinVal !== '' ? '&valMin=' + toEur(Number(valMinVal)) : '') +
    (valMaxVal !== '' ? '&valMax=' + toEur(Number(valMaxVal)) : '') +
    '&sort=' + sortBy;
}

async function loadSets() {
  const mode = inv.checked ? 'inventory' : 'all';
  setsCache = await api('/api/sets?mode=' + mode +
    '&name=' + encodeURIComponent(q.value.trim()) + filterQuery());
  renderSetOptions();
}

function cardPrice(c) {
  // Show the foil price when the only copies owned are foils.
  const foilOnly = c.stacks.length > 0 && c.stacks.every((s) => s.finish !== 'nonfoil');
  return {
    eur: foilOnly ? (c.priceEurFoil ?? c.priceEur) : (c.priceEur ?? c.priceEurFoil),
    usd: foilOnly ? (c.priceUsdFoil ?? c.priceUsd) : (c.priceUsd ?? c.priceUsdFoil)
  };
}

const pagerEl = $('pager'), prevBtn = $('prevPage'), nextBtn = $('nextPage'), pageInfo = $('pageInfo');

function renderPager() {
  if (inv.checked || totalResults <= PAGE_SIZE) { pagerEl.style.display = 'none'; return; }
  pagerEl.style.display = 'flex';
  const pages = Math.ceil(totalResults / PAGE_SIZE);
  pageInfo.textContent = 'page ' + (page + 1).toLocaleString() + ' of ' + pages.toLocaleString();
  prevBtn.disabled = page === 0;
  nextBtn.disabled = page >= pages - 1;
}

prevBtn.onclick = () => { if (page > 0) { page--; refresh(); window.scrollTo(0, 0); } };
nextBtn.onclick = () => { page++; refresh(); window.scrollTo(0, 0); };

function render() {
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  cards.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'card' + (!inv.checked && c.quantity > 0 ? ' owned' : '');
    d.onclick = () => showBig(c);
    d.oncontextmenu = (e) => { e.preventDefault(); openDeckMenu(c.scryfallId, c.name, e.clientX, e.clientY); };
    const p = cardPrice(c);
    const hasFoil = c.stacks.some((s) => s.finish !== 'nonfoil');
    const foilPrice = c.priceEurFoil != null ? cm(c.priceEurFoil)
      : (c.priceUsdFoil != null ? usd(c.priceUsdFoil) : null);
    d.innerHTML =
      (c.quantity > 1 && inv.checked ? '<div class="badge">×' + c.quantity + '</div>' : '') +
      (!inv.checked && c.quantity > 0 ? '<div class="badge own">own ×' + c.quantity + '</div>' : '') +
      (hasFoil ? '<div class="badge foil">✦ foil</div>' : '') +
      (c.fullArt ? '<div class="badge fullart">◈ full art</div>' : '') +
      (c.borderless ? '<div class="badge borderless">▢ borderless</div>' : '') +
      (c.imageUri
        ? '<img loading="lazy" alt="" src="' + esc(c.imageUri) + '">'
        : '<div class="noimg">' + esc(c.name) + '</div>') +
      '<div class="meta"><div class="nm">' + esc(c.name) + '</div>' +
      '<div class="st">' + esc(c.setName) + ' · #' + esc(c.collectorNumber) + '</div>' +
      '<div class="pr">' + (cm(p.eur) ? '<span class="eur">' + cm(p.eur) + '</span>' : '<span class="eur">' + (fxRate ? '£' : '€') + ' —</span>') +
      (usd(p.usd) ? '<span class="usd">' + usd(p.usd) + '</span>' : '') +
      (foilPrice ? '<span class="usd">✦ ' + foilPrice + '</span>' : '') + '</div></div>';
    const img = d.querySelector('img');
    if (img) img.onerror = () => {
      const n = document.createElement('div');
      n.className = 'noimg';
      n.textContent = c.name;
      img.replaceWith(n);
    };
    frag.appendChild(d);
  });
  grid.appendChild(frag);
}

function stockRows(c) {
  const finishes = ['nonfoil', 'foil'];
  if (c.stacks.some((s) => s.finish === 'etched')) finishes.push('etched');
  return finishes.map((f) => {
    const st = c.stacks.find((s) => s.finish === f);
    const q = st ? st.quantity : 0;
    return '<div class="stock-row"><span class="fin">' + f + '</span>' +
      '<button class="adj" data-f="' + f + '" data-d="-1"' + (q === 0 ? ' disabled' : '') + '>−</button>' +
      '<b>×' + q + '</b>' +
      '<button class="adj" data-f="' + f + '" data-d="1">＋</button></div>';
  }).join('');
}

async function adjust(c, finish, delta) {
  await api('/api/adjust?id=' + encodeURIComponent(c.scryfallId) +
    '&finish=' + encodeURIComponent(finish) + '&delta=' + delta);
  inventory = null;
  await refresh();
  stamp = await readStamp();   // our own write — don't let the poll re-refresh
  const pool = inv.checked && inventory ? inventory.cards : cards;
  const updated = pool.find((x) => x.scryfallId === c.scryfallId);
  if (updated) showBig(updated);
  else overlay.classList.remove('show');
}

// --- Two-sided cards -------------------------------------------------------
// Transform and modal DFC printings carry a second face; the reference DB
// stores its art, and the button below turns the card over rather than just
// swapping the picture.

/** The face names of a "Norman Osborn // Green Goblin" style card name. */
function faceNames(c) {
  const parts = String(c.name).split(' // ');
  return parts.length === 2 ? parts : null;
}

function flipButtonHtml(c) {
  const names = faceNames(c);
  const label = names ? names[1] : 'Flip card';
  return '<button class="flip-btn" id="flipBtn" title="Turn the card over (F)">' +
    '<span class="turn">⟳</span><span class="flip-label">' + esc(label) + '</span></button>';
}

/** Wire the flip button to the 3D stage, if this card has both. */
function wireFlip(c) {
  const btn = big.querySelector('#flipBtn'), flipper = big.querySelector('.flipper');
  if (!btn || !flipper) return;
  const names = faceNames(c);
  btn.onclick = (e) => {
    e.stopPropagation();
    flipper.classList.add('turning');
    const showingBack = flipper.classList.toggle('flipped');
    if (names) btn.querySelector('.flip-label').textContent = names[showingBack ? 0 : 1];
  };
  // Drop the slow transition once the turn lands, so zooming stays snappy.
  flipper.addEventListener('transitionend', () => flipper.classList.remove('turning'));
}

/**
 * A reference DB built before the face columns existed knows nothing about
 * back faces, so resolve this one printing live (cached server-side) and slot
 * the back + button in if it turns out to be two-sided. The token guards
 * against the answer landing after the shop has moved on to another card.
 */
async function resolveFaces(c, token) {
  let backImageUri = null;
  try {
    const r = await api('/api/faces?id=' + encodeURIComponent(c.scryfallId));
    backImageUri = r && r.backImageUri ? r.backImageUri : null;
  } catch (e) { /* offline — no flip on offer */ }
  c.backImageUri = backImageUri;
  c.facesKnown = true;
  if (token !== bigToken || !backImageUri) return;
  const flipper = big.querySelector('.flipper'), art = big.querySelector('.art');
  if (!flipper || !art || flipper.querySelector('.back')) return;
  const img = document.createElement('img');
  img.className = 'face back';
  img.onerror = () => { img.onerror = null; img.src = backImageUri; };
  img.src = backImageUri.replace('/normal/', '/large/');
  flipper.appendChild(img);
  art.insertAdjacentHTML('beforeend', flipButtonHtml(c));
  wireFlip(c);
}

// Bumped on every overlay open, so a slow face lookup can tell whether the
// card it was asked about is still the one on screen.
let bigToken = 0;

function showBig(c) {
  const bigUri = c.imageUri ? c.imageUri.replace('/normal/', '/large/') : null;
  const backUri = c.backImageUri ? c.backImageUri.replace('/normal/', '/large/') : null;
  const token = ++bigToken;
  big.innerHTML =
    '<button class="close-x" title="Close (Esc)">✕</button>' +
    (bigUri
      ? '<div class="art"><div class="zoom-wrap" title="click to zoom"><div class="flipper">' +
        '<img class="face front" src="' + esc(bigUri) +
        '" onerror="this.src=\\'' + esc(c.imageUri) + '\\'">' +
        (backUri
          ? '<img class="face back" src="' + esc(backUri) +
            '" onerror="this.src=\\'' + esc(c.backImageUri) + '\\'">'
          : '') +
        '</div></div>' +
        // The button lives under the card, where the eye already is.
        (backUri ? flipButtonHtml(c) : '') + '</div>'
      : '') +
    '<div class="info"><h2>' + esc(c.name) + '</h2>' +
    '<div class="st">' + esc(c.setName) + ' (' + esc(c.setCode.toUpperCase()) + ') · #' +
    esc(c.collectorNumber) + (c.rarity ? ' · ' + esc(c.rarity) : '') + '</div>' +
    '<div class="prices">' +
    '<div class="eur">' + (cm(c.priceEur) ?? '—') + ' <small>Cardmarket' +
      (fxRate && c.priceEur != null ? ' (' + eur(c.priceEur) + ')' : '') + '</small></div>' +
    (c.priceEurFoil != null ? '<div>' + cm(c.priceEurFoil) + ' <small>Cardmarket foil' +
      (fxRate ? ' (' + eur(c.priceEurFoil) + ')' : '') + '</small></div>' : '') +
    (c.priceUsd != null ? '<div>' + usd(c.priceUsd) + ' <small>USD</small></div>' : '') +
    (c.priceUsdFoil != null ? '<div>' + usd(c.priceUsdFoil) + ' <small>USD foil</small></div>' : '') +
    '</div>' +
    '<div class="own">' + (c.quantity > 0
      ? 'In stock: ' + c.quantity
      : '<span style="color:var(--dim)">Not in inventory</span>') +
    stockRows(c) + '</div>' +
    '<a class="ext-link" target="_blank" rel="noreferrer" href="https://scryfall.com/card/' +
      encodeURIComponent(c.setCode) + '/' + encodeURIComponent(c.collectorNumber) +
      '" title="Rulings, legality, card backs / transforms, every printing — opens in your browser">' +
      'Full details on Scryfall ↗</a>' +
    '<button class="add-deck-btn" id="addDeckBtn">＋ Add to deck</button>' +
    '</div>';
  big.querySelectorAll('.adj').forEach((btn) => {
    btn.onclick = () => adjust(c, btn.dataset.f, Number(btn.dataset.d));
  });
  const addBtn = big.querySelector('#addDeckBtn');
  if (addBtn) addBtn.onclick = (e) => {
    e.stopPropagation();
    const r = addBtn.getBoundingClientRect();
    openDeckMenu(c.scryfallId, c.name, r.left, r.bottom + 6);
  };
  // Magnifier: click the art to zoom, mouse pans, click again to zoom out.
  const zw = big.querySelector('.zoom-wrap');
  if (zw) {
    const stage = zw.querySelector('.flipper');
    zw.onclick = (e) => {
      e.stopPropagation();
      // Back to centre when un-zooming, or the next flip would swing off-axis.
      if (zw.classList.toggle('zoomed') === false) stage.style.transformOrigin = '';
    };
    zw.onmousemove = (e) => {
      if (!zw.classList.contains('zoomed')) return;
      const r = zw.getBoundingClientRect();
      stage.style.transformOrigin =
        ((e.clientX - r.left) / r.width * 100).toFixed(1) + '% ' +
        ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
    };
  }
  wireFlip(c);
  if (!c.facesKnown && bigUri) resolveFaces(c, token);
  big.querySelector('.close-x').onclick = () => overlay.classList.remove('show');
  overlay.classList.add('show');
}
overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('show'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('show'); });
// F turns the open card over — as long as the shop isn't typing in a filter.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (!overlay.classList.contains('show')) return;
  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  const btn = big.querySelector('#flipBtn');
  if (btn) { e.preventDefault(); btn.click(); }
});

// --- Add to deck (right-click a card, or the button on the full-card view) ---
let decks = [];
const deckMenu = $('deckMenu'), toastEl = $('toast');
function closeDeckMenu() { deckMenu.style.display = 'none'; deckMenu.innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (deckMenu.style.display === 'block' && !deckMenu.contains(e.target)) closeDeckMenu();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDeckMenu(); });
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}
async function addToDeck(scryfallId, deckId, deckName) {
  closeDeckMenu();
  try {
    const r = await api('/api/deck-add?deckId=' + deckId + '&id=' + encodeURIComponent(scryfallId) + '&qty=1');
    toast(r && r.ok ? ('Added to ' + deckName) : 'Could not add card');
  } catch (e) { toast('Could not add card'); }
}
function newDeckInput(scryfallId) {
  deckMenu.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'ctx-newdeck';
  const inp = document.createElement('input'); inp.className = 'ctx-input'; inp.placeholder = 'New deck name…';
  const go = document.createElement('button'); go.className = 'ctx-item new'; go.textContent = 'Create';
  const create = async () => {
    const nm = inp.value.trim(); if (!nm) return;
    try {
      const d = await api('/api/deck-create?name=' + encodeURIComponent(nm));
      if (d && d.id) await addToDeck(scryfallId, d.id, nm);
    } catch (e) { toast('Could not create deck'); }
  };
  go.onclick = (ev) => { ev.stopPropagation(); create(); };
  inp.onclick = (ev) => ev.stopPropagation();
  inp.onkeydown = (ev) => { if (ev.key === 'Enter') create(); };
  wrap.appendChild(inp); wrap.appendChild(go); deckMenu.appendChild(wrap); inp.focus();
}
async function openDeckMenu(scryfallId, name, x, y) {
  try { decks = (await api('/api/decks')) || []; } catch (e) { decks = []; }
  deckMenu.innerHTML = '';
  const t = document.createElement('div'); t.className = 'ctx-title';
  t.textContent = 'Add "' + name + '" to…'; deckMenu.appendChild(t);
  if (!decks.length) {
    const em = document.createElement('div'); em.className = 'ctx-empty';
    em.textContent = 'No decks yet — make one below.'; deckMenu.appendChild(em);
  }
  decks.forEach((d) => {
    const b = document.createElement('button'); b.className = 'ctx-item';
    b.textContent = d.name + '  (' + d.cardCount + ')';
    b.onclick = (ev) => { ev.stopPropagation(); addToDeck(scryfallId, d.id, d.name); };
    deckMenu.appendChild(b);
  });
  const nw = document.createElement('button'); nw.className = 'ctx-item new'; nw.textContent = '＋ New deck…';
  nw.onclick = (ev) => { ev.stopPropagation(); newDeckInput(scryfallId); };
  deckMenu.appendChild(nw);
  deckMenu.style.display = 'block';
  const w = deckMenu.offsetWidth, h = deckMenu.offsetHeight;
  deckMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  deckMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
}

// Refreshes overlap (typing, the tick, the freshness poll) and the any-card
// query is the slow one — so only the newest run is allowed to paint.
let refreshSeq = 0;

async function refresh(opts) {
  const background = !!(opts && opts.background);
  const my = ++refreshSeq;
  void loadSets();
  const name = q.value.trim().toLowerCase();
  const set = setSel.value;
  if (inv.checked) {
    pagerEl.style.display = 'none';
    if (!inventory) {
      status.textContent = 'Loading collection…';
      inventory = await api('/api/inventory');
      if (my !== refreshSeq) return;
    }
    totals.innerHTML = inventory.totalCards + ' cards · <b title="Cardmarket' +
      (fxAsOf ? ', converted at the ECB rate of ' + fxAsOf : '') + '">' +
      (cm(inventory.totalValueEur) ?? '—') + '</b> · ' + (usd(inventory.totalValueUsd) ?? '$0.00');
    cards = sortCards(inventory.cards.filter((c) =>
      (!name || c.name.toLowerCase().includes(name)) && (!set || c.setCode === set) &&
      chipMatch(c)), !!set);
    status.textContent = cards.length
      ? cards.length + ' card' + (cards.length === 1 ? '' : 's') + ' shown'
      : 'Nothing matches — clear the search or pick another set.';
  } else {
    totals.textContent = 'Browsing all cards · prices: Cardmarket' +
      (fxRate ? ' in £ (ECB ' + fxAsOf + ')' : ' in €');
    status.textContent = 'Loading…';
    const r = await api('/api/cards?name=' + encodeURIComponent(name) +
      '&set=' + encodeURIComponent(set) + '&offset=' + (page * PAGE_SIZE) +
      filterQuery());
    if (my !== refreshSeq) return;
    totalResults = r.total;
    cards = r.cards;
    const ownedCount = cards.filter((c) => c.quantity > 0).length;
    const from = page * PAGE_SIZE + 1;
    const to = page * PAGE_SIZE + cards.length;
    status.textContent = totalResults === 0
      ? 'No cards match.'
      : 'Cards ' + from.toLocaleString() + '–' + to.toLocaleString() + ' of ' +
        totalResults.toLocaleString() +
        (set && ownedCount > 0 ? ' · you own ' + ownedCount + ' shown (green tiles)' : '');
    renderPager();
  }
  render();
  // Auto-open the big view when a name search narrows to exactly one card name
  // — but never on a background refresh, which would pop a modal unprompted.
  if (!background && name && cards.length >= 1) {
    const names = new Set(cards.map((c) => c.name.toLowerCase()));
    if (names.size === 1 && (cards.length === 1 || inv.checked)) showBig(cards[0]);
  }
}

q.addEventListener('input', () => { page = 0; clearTimeout(debounce); debounce = setTimeout(refresh, 200); });
setSel.addEventListener('change', () => { page = 0; updateClear(); refresh(); });
setFilterInput.addEventListener('input', () => { setFilterText = setFilterInput.value; renderSetOptions(); });
const typeSel2 = $('typeSel');
typeSel2.addEventListener('change', async () => {
  page = 0;
  selectedType = typeSel2.value;
  subtypeText = '';
  $('subtypeFilter').value = '';
  updateClear();
  await refresh();
  rebuildSubtypes();
});
const subtypeInput = $('subtypeFilter');
subtypeInput.addEventListener('input', () => {
  page = 0;
  subtypeText = subtypeInput.value;
  updateClear();
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 200);
});
document.querySelectorAll('.chip[data-rarity]').forEach((chip) => {
  chip.onclick = () => {
    const r = chip.dataset.rarity;
    if (activeRarities.has(r)) { activeRarities.delete(r); chip.classList.remove('on'); }
    else { activeRarities.add(r); chip.classList.add('on'); }
    page = 0;
    updateClear();
    refresh();
  };
});
const chipCommander = $('chipCommander');
chipCommander.onclick = () => {
  page = 0;
  wantCommander = !wantCommander;
  chipCommander.classList.toggle('on', wantCommander);
  updateClear();
  refresh();
};
const chipFoil = $('chipFoil');
chipFoil.onclick = () => {
  page = 0;
  wantFoil = !wantFoil;
  chipFoil.classList.toggle('on', wantFoil);
  updateClear();
  refresh();
};
const chipFullArt = $('chipFullArt');
chipFullArt.onclick = () => {
  page = 0;
  wantFullArt = !wantFullArt;
  chipFullArt.classList.toggle('on', wantFullArt);
  updateClear();
  refresh();
};
const chipBorderless = $('chipBorderless');
chipBorderless.onclick = () => {
  page = 0;
  wantBorderless = !wantBorderless;
  chipBorderless.classList.toggle('on', wantBorderless);
  updateClear();
  refresh();
};
document.querySelectorAll('.color-chip').forEach((chip) => {
  chip.onclick = () => {
    const col = chip.dataset.color;
    if (activeColors.has(col)) { activeColors.delete(col); chip.classList.remove('on'); }
    else { activeColors.add(col); chip.classList.add('on'); }
    page = 0;
    updateClear();
    refresh();
  };
});
const colorModeSel = $('colorMode');
colorModeSel.addEventListener('change', () => {
  colorMode = colorModeSel.value;
  if (activeColors.size > 0) { page = 0; refresh(); }
});
const mvMinInput = $('mvMin'), mvMaxInput = $('mvMax');
function onMvChange() {
  mvMinVal = mvMinInput.value.trim();
  mvMaxVal = mvMaxInput.value.trim();
  page = 0;
  updateClear();
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 250);
}
mvMinInput.addEventListener('input', onMvChange);
mvMaxInput.addEventListener('input', onMvChange);
const valMinInput = $('valMin'), valMaxInput = $('valMax');
function onValChange() {
  valMinVal = valMinInput.value.trim();
  valMaxVal = valMaxInput.value.trim();
  page = 0;
  updateClear();
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 250);
}
valMinInput.addEventListener('input', onValChange);
valMaxInput.addEventListener('input', onValChange);
const sortSel = $('sortSel');
sortSel.addEventListener('change', () => {
  sortBy = sortSel.value;
  page = 0;   // a new order makes the old page number meaningless
  updateClear();
  refresh();
});
clearBtn.onclick = () => {
  page = 0;
  setFilterText = '';
  setFilterInput.value = '';
  selectedType = '';
  typeSel2.value = '';
  subtypeText = '';
  subtypeInput.value = '';
  subtypeInput.style.display = 'none';
  setSel.value = '';
  activeRarities.clear();
  wantCommander = false;
  wantFoil = false;
  wantFullArt = false;
  wantBorderless = false;
  activeColors.clear();
  colorMode = 'only';
  colorModeSel.value = 'only';
  mvMinVal = '';
  mvMaxVal = '';
  mvMinInput.value = '';
  mvMaxInput.value = '';
  valMinVal = '';
  valMaxVal = '';
  valMinInput.value = '';
  valMaxInput.value = '';
  sortBy = 'auto';
  sortSel.value = 'auto';
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  renderSetOptions();
  refresh();
};
// Toggling the inventory tick keeps the selected set open when it still
// exists in the new mode (it always does when unticking into all-sets).
inv.addEventListener('change', () => { page = 0; refresh(); });

// --- Stay current: cards scanned in (or sold) while this page is open ---
// The collection is cached here for snappy filtering, so a write elsewhere in
// the app would otherwise leave stale totals on screen until a reload. Poll a
// tiny change token instead — it only differs after an actual inventory write.
let stamp = null;
async function readStamp() {
  try {
    const r = await fetch('/api/stamp');
    return r.ok ? (await r.json()).stamp : null;
  } catch (e) { return null; }
}
async function checkFresh() {
  if (document.hidden) return;
  const s = await readStamp();
  if (s == null) return;
  if (stamp !== null && s !== stamp) {
    stamp = s;
    inventory = null;
    await refresh({ background: true });
  } else {
    stamp = s;
  }
}
setInterval(checkFresh, 5000);
document.addEventListener('visibilitychange', checkFresh);
window.addEventListener('focus', checkFresh);

(async () => {
  try {
    const r = await api('/api/rate');
    fxRate = r.gbpPerEur; fxAsOf = r.asOf;
  } catch (e) { /* € fallback */ }
  if (!fxRate) $('valLbl').textContent = 'Value €:';   // offline: prices show in €
  stamp = await readStamp();
  await refresh();
})();
</script>
</body>
</html>`
