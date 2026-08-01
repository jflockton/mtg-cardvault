// "Show Inventory" browser viewer: a tiny HTTP server bound to 127.0.0.1
// serving one self-contained page + JSON endpoints over the DataStore.
// Loopback-only on an ephemeral port — no firewall prompts, no CORS.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DataStore } from './store'

let server: http.Server | null = null
let baseUrl: string | null = null

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
            store.viewerSearch(url.searchParams.get('name') ?? '', url.searchParams.get('set') ?? '')
          )
        } else if (url.pathname === '/api/sets') {
          json(res, store.viewerSets(url.searchParams.get('mode') === 'all' ? 'all' : 'inventory'))
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
    --bg: #17141f; --panel: #221e2e; --line: #37324a;
    --text: #e8e5f2; --dim: #9b95b0; --accent: #e01f2f; --gold: #d8b64a;
  }
  * { box-sizing: border-box; }
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
  #status { padding: 10px 18px; color: var(--dim); }
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
  #big { display: flex; gap: 22px; max-width: 900px; max-height: 92vh; align-items: center; }
  #big img { height: min(80vh, 640px); border-radius: 18px;
             box-shadow: 0 12px 60px rgba(0,0,0,.6); }
  #big .info { max-width: 300px; }
  #big h2 { margin: 0 0 6px; font-size: 20px; }
  #big .st { color: var(--dim); margin-bottom: 12px; }
  #big .prices div { margin: 4px 0; }
  #big .prices .eur { color: var(--gold); font-weight: 700; font-size: 17px; }
  #big .own { margin-top: 12px; color: var(--gold); }
  .banner { background: #4b1620; color: #ffd7dc; padding: 10px 18px; display: none; }
  @media (max-width: 700px) { #big { flex-direction: column; } #big img { height: 52vh; } }
</style>
</head>
<body>
<header>
  <h1>🕷 <span>MTG CardVault</span></h1>
  <input id="q" type="search" placeholder="Type a card name…" autofocus>
  <select id="set"><option value="">All sets</option></select>
  <label class="tick"><input id="inv" type="checkbox" checked> In my inventory</label>
  <div class="totals" id="totals"></div>
</header>
<div class="banner" id="banner">Can’t reach MTG CardVault — is the app still running? Reopen this page from the app.</div>
<div id="status"></div>
<div id="grid"></div>

<div id="overlay"><div id="big"></div></div>

<script>
'use strict';
const $ = (id) => document.getElementById(id);
const q = $('q'), setSel = $('set'), inv = $('inv'), grid = $('grid'),
      totals = $('totals'), status = $('status'), overlay = $('overlay'), big = $('big');
let inventory = null;   // cached /api/inventory payload
let cards = [];         // currently displayed cards
let debounce = 0;

const eur = (v) => v == null ? null : '€' + v.toFixed(2);
const usd = (v) => v == null ? null : '$' + v.toFixed(2);
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

async function loadSets() {
  const mode = inv.checked ? 'inventory' : 'all';
  const sets = await api('/api/sets?mode=' + mode);
  const keep = setSel.value;
  setSel.innerHTML = '<option value="">All sets</option>' + sets.map((s) =>
    '<option value="' + esc(s.code) + '">' + esc(s.name) + ' (' + s.code.toUpperCase() + ')' +
    (s.count ? ' — ' + s.count : '') + '</option>').join('');
  if ([...setSel.options].some((o) => o.value === keep)) setSel.value = keep;
}

function cardPrice(c) {
  // Show the foil price when the only copies owned are foils.
  const foilOnly = c.stacks.length > 0 && c.stacks.every((s) => s.finish !== 'nonfoil');
  return {
    eur: foilOnly ? (c.priceEurFoil ?? c.priceEur) : (c.priceEur ?? c.priceEurFoil),
    usd: foilOnly ? (c.priceUsdFoil ?? c.priceUsd) : (c.priceUsd ?? c.priceUsdFoil)
  };
}

function render() {
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  cards.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'card';
    d.onclick = () => showBig(c);
    const p = cardPrice(c);
    const hasFoil = c.stacks.some((s) => s.finish !== 'nonfoil');
    d.innerHTML =
      (c.quantity > 1 && inv.checked ? '<div class="badge">×' + c.quantity + '</div>' : '') +
      (!inv.checked && c.quantity > 0 ? '<div class="badge own">own ×' + c.quantity + '</div>' : '') +
      (hasFoil ? '<div class="badge foil">✦ foil</div>' : '') +
      (c.imageUri
        ? '<img loading="lazy" alt="" src="' + esc(c.imageUri) + '">'
        : '<div class="noimg">' + esc(c.name) + '</div>') +
      '<div class="meta"><div class="nm">' + esc(c.name) + '</div>' +
      '<div class="st">' + esc(c.setName) + ' · #' + esc(c.collectorNumber) + '</div>' +
      '<div class="pr">' + (eur(p.eur) ? '<span class="eur">' + eur(p.eur) + '</span>' : '<span class="eur">€ —</span>') +
      (usd(p.usd) ? '<span class="usd">' + usd(p.usd) + '</span>' : '') + '</div></div>';
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

function showBig(c) {
  const bigUri = c.imageUri ? c.imageUri.replace('/normal/', '/large/') : null;
  const stacks = c.stacks.map((s) =>
    s.finish + ' ×' + s.quantity + (s.finish !== 'nonfoil'
      ? ' (' + (eur(c.priceEurFoil ?? c.priceEur) ?? '€ —') + ')'
      : ' (' + (eur(c.priceEur) ?? '€ —') + ')')).join(' · ');
  big.innerHTML =
    (bigUri ? '<img src="' + esc(bigUri) + '" onerror="this.src=\\'' + esc(c.imageUri) + '\\'">' : '') +
    '<div class="info"><h2>' + esc(c.name) + '</h2>' +
    '<div class="st">' + esc(c.setName) + ' (' + esc(c.setCode.toUpperCase()) + ') · #' +
    esc(c.collectorNumber) + (c.rarity ? ' · ' + esc(c.rarity) : '') + '</div>' +
    '<div class="prices">' +
    '<div class="eur">' + (eur(c.priceEur) ?? '€ —') + ' <small>Cardmarket</small></div>' +
    (c.priceEurFoil != null ? '<div>' + eur(c.priceEurFoil) + ' <small>Cardmarket foil</small></div>' : '') +
    (c.priceUsd != null ? '<div>' + usd(c.priceUsd) + ' <small>USD</small></div>' : '') +
    (c.priceUsdFoil != null ? '<div>' + usd(c.priceUsdFoil) + ' <small>USD foil</small></div>' : '') +
    '</div>' +
    (c.quantity > 0
      ? '<div class="own">In stock: ' + c.quantity + (stacks ? '<br><small>' + stacks + '</small>' : '') + '</div>'
      : '<div class="own" style="color:var(--dim)">Not in inventory</div>') +
    '</div>';
  overlay.classList.add('show');
}
overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('show'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('show'); });

async function refresh() {
  const name = q.value.trim().toLowerCase();
  const set = setSel.value;
  if (inv.checked) {
    if (!inventory) {
      status.textContent = 'Loading collection…';
      inventory = await api('/api/inventory');
    }
    totals.innerHTML = inventory.totalCards + ' cards · <b>' +
      (eur(inventory.totalValueEur) ?? '€0.00') + '</b> · ' + (usd(inventory.totalValueUsd) ?? '$0.00');
    cards = inventory.cards.filter((c) =>
      (!name || c.name.toLowerCase().includes(name)) && (!set || c.setCode === set));
    if (set) cards = [...cards].sort((a, b) =>
      (parseInt(a.collectorNumber, 10) || 0) - (parseInt(b.collectorNumber, 10) || 0) ||
      a.collectorNumber.localeCompare(b.collectorNumber));
    status.textContent = cards.length
      ? cards.length + ' card' + (cards.length === 1 ? '' : 's') + ' shown'
      : 'Nothing matches — clear the search or pick another set.';
  } else {
    totals.textContent = 'Browsing all cards · prices: Cardmarket';
    if (!name && !set) {
      cards = [];
      status.textContent = 'Type a card name or pick a set to browse every card that exists.';
    } else {
      status.textContent = 'Searching…';
      cards = await api('/api/cards?name=' + encodeURIComponent(name) + '&set=' + encodeURIComponent(set));
      status.textContent = cards.length
        ? cards.length + ' result' + (cards.length === 1 ? '' : 's') + (cards.length === 200 ? ' (first 200 — narrow the search)' : '')
        : 'No cards match.';
    }
  }
  render();
  // Auto-open the big view when a name search narrows to exactly one card name.
  if (name && cards.length >= 1) {
    const names = new Set(cards.map((c) => c.name.toLowerCase()));
    if (names.size === 1 && (cards.length === 1 || inv.checked)) showBig(cards[0]);
  }
}

q.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(refresh, 200); });
setSel.addEventListener('change', refresh);
inv.addEventListener('change', async () => { setSel.value = ''; await loadSets(); refresh(); });

(async () => { await loadSets(); await refresh(); })();
</script>
</body>
</html>`
