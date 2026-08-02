// "Show Inventory" browser viewer: a tiny HTTP server bound to 127.0.0.1
// serving one self-contained page + JSON endpoints over the DataStore.
// Loopback-only on an ephemeral port — no firewall prompts, no CORS.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DataStore } from './store'
import type { Finish } from '../shared/types'
// Inlined art: Gwen badges the page header, Spidey rides the menu button.
import { GWEN_SVG as gwenSvg, SPIDEY_SVG as spideySvg } from './viewerArt'

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
              {
                type: url.searchParams.get('type') ?? '',
                subtype: url.searchParams.get('subtype') ?? '',
                rarities: (url.searchParams.get('rarities') ?? '').split(',').filter(Boolean),
                commander: url.searchParams.get('commander') === '1',
                foil: url.searchParams.get('foil') === '1'
              }
            )
          )
        } else if (url.pathname === '/api/sets') {
          json(
            res,
            store.viewerSets(url.searchParams.get('mode') === 'all' ? 'all' : 'inventory', {
              name: url.searchParams.get('name') ?? '',
              type: url.searchParams.get('type') ?? '',
              subtype: url.searchParams.get('subtype') ?? '',
              rarities: (url.searchParams.get('rarities') ?? '').split(',').filter(Boolean),
              commander: url.searchParams.get('commander') === '1',
              foil: url.searchParams.get('foil') === '1'
            })
          )
        } else if (url.pathname === '/api/rate') {
          void gbpRate().then((r) => json(res, r))
        } else if (url.pathname === '/api/adjust') {
          const ok = store.viewerAdjust(
            url.searchParams.get('id') ?? '',
            (url.searchParams.get('finish') ?? 'nonfoil') as Finish,
            Number(url.searchParams.get('delta') ?? 0)
          )
          json(res, { ok })
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
  #overlay { position: fixed; inset: 0; background: rgba(10,8,14,.82); display: none;
    align-items: center; justify-content: center; z-index: 20; padding: 24px; }
  #overlay.show { display: flex; }
  #big { display: flex; gap: 22px; max-width: 900px; max-height: 92vh; align-items: center;
         position: relative; }
  #big img { height: min(80vh, 640px); border-radius: 18px;
             box-shadow: 0 12px 60px rgba(0,0,0,.6); }
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
  <span class="face-badge">${gwenSvg}</span>
  <h1><span>Show Inventory</span></h1>
  <input id="q" type="search" placeholder="Type a card name…" autofocus>
  <select id="set"><option value="">All sets</option></select>
  <label class="tick"><input id="inv" type="checkbox" checked> In my inventory</label>
  <div class="totals" id="totals"></div>
  <button id="menuBtn" class="menu-btn" title="Close this window">${spideySvg}<span>Return to main menu</span></button>
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
let selectedType = '';
let subtypeText = '';

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
  if (activeRarities.size > 0 && !activeRarities.has(c.rarity)) return false;
  if (wantCommander && !(c.typeLine || '').includes('Legendary Creature')) return false;
  if (wantFoil) {
    const foil = inv.checked
      ? c.stacks.some((s) => s.finish !== 'nonfoil')
      : (c.priceEurFoil != null || c.priceUsdFoil != null);
    if (!foil) return false;
  }
  return true;
}

function chipsActive() {
  return activeRarities.size > 0 || wantCommander || wantFoil ||
    selectedType !== '' || subtypeText.trim() !== '';
}
const setFilterInput = $('setFilter');
const clearBtn = $('clearFilters');

function renderSetOptions() {
  const f = setFilterText.trim().toLowerCase();
  const shown = f
    ? setsCache.filter((s) => s.code.includes(f) || s.name.toLowerCase().includes(f))
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

async function loadSets() {
  const mode = inv.checked ? 'inventory' : 'all';
  setsCache = await api('/api/sets?mode=' + mode +
    '&name=' + encodeURIComponent(q.value.trim()) +
    '&type=' + encodeURIComponent(selectedType) +
    '&subtype=' + encodeURIComponent(subtypeText) +
    '&rarities=' + encodeURIComponent([...activeRarities].join(',')) +
    (wantCommander ? '&commander=1' : '') +
    (wantFoil ? '&foil=1' : ''));
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
  const pool = inv.checked && inventory ? inventory.cards : cards;
  const updated = pool.find((x) => x.scryfallId === c.scryfallId);
  if (updated) showBig(updated);
  else overlay.classList.remove('show');
}

function showBig(c) {
  const bigUri = c.imageUri ? c.imageUri.replace('/normal/', '/large/') : null;
  big.innerHTML =
    '<button class="close-x" title="Close (Esc)">✕</button>' +
    (bigUri ? '<img src="' + esc(bigUri) + '" onerror="this.src=\\'' + esc(c.imageUri) + '\\'">' : '') +
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
  big.querySelector('.close-x').onclick = () => overlay.classList.remove('show');
  overlay.classList.add('show');
}
overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('show'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('show'); });

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

async function refresh() {
  void loadSets();
  const name = q.value.trim().toLowerCase();
  const set = setSel.value;
  if (inv.checked) {
    pagerEl.style.display = 'none';
    if (!inventory) {
      status.textContent = 'Loading collection…';
      inventory = await api('/api/inventory');
    }
    totals.innerHTML = inventory.totalCards + ' cards · <b title="Cardmarket' +
      (fxAsOf ? ', converted at the ECB rate of ' + fxAsOf : '') + '">' +
      (cm(inventory.totalValueEur) ?? '—') + '</b> · ' + (usd(inventory.totalValueUsd) ?? '$0.00');
    cards = inventory.cards.filter((c) =>
      (!name || c.name.toLowerCase().includes(name)) && (!set || c.setCode === set) &&
      chipMatch(c));
    if (set) cards = [...cards].sort((a, b) =>
      (parseInt(a.collectorNumber, 10) || 0) - (parseInt(b.collectorNumber, 10) || 0) ||
      a.collectorNumber.localeCompare(b.collectorNumber));
    status.textContent = cards.length
      ? cards.length + ' card' + (cards.length === 1 ? '' : 's') + ' shown'
      : 'Nothing matches — clear the search or pick another set.';
  } else {
    totals.textContent = 'Browsing all cards · prices: Cardmarket' +
      (fxRate ? ' in £ (ECB ' + fxAsOf + ')' : ' in €');
    status.textContent = 'Loading…';
    const r = await api('/api/cards?name=' + encodeURIComponent(name) +
      '&set=' + encodeURIComponent(set) + '&offset=' + (page * PAGE_SIZE) +
      '&type=' + encodeURIComponent(selectedType) +
      '&subtype=' + encodeURIComponent(subtypeText) +
      '&rarities=' + encodeURIComponent([...activeRarities].join(',')) +
      (wantCommander ? '&commander=1' : '') +
      (wantFoil ? '&foil=1' : ''));
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
  // Auto-open the big view when a name search narrows to exactly one card name.
  if (name && cards.length >= 1) {
    const names = new Set(cards.map((c) => c.name.toLowerCase()));
    if (names.size === 1 && (cards.length === 1 || inv.checked)) showBig(cards[0]);
  }
}

document.getElementById('menuBtn').onclick = () => window.close();
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
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
  renderSetOptions();
  refresh();
};
// Toggling the inventory tick keeps the selected set open when it still
// exists in the new mode (it always does when unticking into all-sets).
inv.addEventListener('change', () => { page = 0; refresh(); });

(async () => {
  try {
    const r = await api('/api/rate');
    fxRate = r.gbpPerEur; fxAsOf = r.asOf;
  } catch (e) { /* € fallback */ }
  await refresh();
})();
</script>
</body>
</html>`
