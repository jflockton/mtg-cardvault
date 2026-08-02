// Sanity-check a built reference DB + exercise the DataStore end to end:
// random lookups, a name search, and an inventory add/increment/remove cycle
// against a throwaway inventory DB.
//
// Usage: npm run check:refdb [-- --data ./data]

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { DataStore } from '../src/main/store'
import { openInventoryViewer, closeInventoryViewer } from '../src/main/viewer'

const dataArgIdx = process.argv.indexOf('--data')
const dataDir = path.resolve(dataArgIdx !== -1 ? process.argv[dataArgIdx + 1] : 'data')

// Use a scratch copy of the inventory DB so this check never touches real stock.
const scratchDir = fs.mkdtempSync(path.join(dataDir, 'check-'))
fs.copyFileSync(path.join(dataDir, 'reference.db'), path.join(scratchDir, 'reference.db'))

const store = new DataStore(scratchDir)

try {
  const status = store.refStatus()
  console.log(`reference: ready=${status.ready} cards=${status.cardCount} updated=${status.updatedAt}`)
  assert(status.ready, 'reference DB not ready')
  assert(status.cardCount > 50000, `suspiciously few cards: ${status.cardCount}`)

  // Well-known printings that must resolve.
  const fixtures: [string, string, string][] = [
    ['m21', '123', 'Skeleton Archer'],
    ['neo', '266', 'Boseiju, Who Endures'],
    ['ltr', '246', 'The One Ring'],
    ['mh1', '217', 'Wrenn and Six']
  ]
  for (const [set, cn, expected] of fixtures) {
    const hit = store.lookup(set, cn)
    assert(hit, `no hit for ${set} #${cn}`)
    assert.equal(hit.name, expected, `${set} #${cn}: got ${hit.name}, expected ${expected}`)
    console.log(`lookup ok: ${set.toUpperCase()} #${cn} → ${hit.name}`)
  }

  // OCR-style inputs: leading zeros and /total suffixes must normalise away.
  const ocrStyle = store.lookup('M21', '0123/274')
  assert.equal(ocrStyle?.name, 'Skeleton Archer', 'OCR-style normalisation failed')
  console.log(`lookup ok: "M21" + "0123/274" → ${ocrStyle!.name} (normalisation works)`)

  const results = store.searchByName('Lightning Bolt')
  assert(results.length > 0, 'name search returned nothing')
  console.log(`search ok: "Lightning Bolt" → ${results.length} printings`)

  // Old-frame resolution: no set code printed — number/total + copyright year.
  if (store.hasSetMetadata()) {
    const res = store.resolveCorner({
      setCode: null,
      number: '13',
      total: 150,
      year: 2008,
      token: false,
      raw: ''
    })
    assert.equal(res.kind, 'exact', `old-frame resolve: expected exact, got ${res.kind}`)
    assert.equal(res.card!.setCode, 'mor', `old-frame resolve landed on ${res.card!.setCode}`)
    console.log(`resolve ok: 13/150 + ©2008 → ${res.card!.name} (MOR #13)`)
  } else {
    console.log('resolve skipped: no set metadata in this DB')
  }

  // Token cards: "T 0008" + parent set code FIN must resolve into the token
  // set (tfin Hero), NOT fin #8 (Auron's Inspiration — a real, wrong card).
  const tokenRes = store.resolveCorner({
    setCode: 'fin',
    number: '8',
    total: null,
    year: null,
    token: true,
    raw: ''
  })
  assert.equal(tokenRes.kind, 'exact', 'token resolve should be exact')
  assert.equal(tokenRes.card!.setCode, 'tfin', `token landed in ${tokenRes.card!.setCode}`)
  assert.equal(tokenRes.card!.name, 'Hero', `token resolved to ${tokenRes.card!.name}`)
  console.log(`resolve ok: T 0008 + FIN → ${tokenRes.card!.name} (TFIN #8, not fin #8)`)

  // Inventory cycle: add, increment, separate foil stack, remove.
  const card = store.lookup('ltr', '246')!
  const first = store.addToInventory(card, 'nonfoil')
  assert.equal(first.quantity, 1)
  const second = store.addToInventory(card, 'nonfoil')
  assert.equal(second.quantity, 2, 'quantity did not increment on duplicate add')
  const foil = store.addToInventory(card, 'foil')
  assert.equal(foil.quantity, 1, 'foil should be a separate stack')
  const summary = store.listInventory()
  assert.equal(summary.totalCards, 3)
  assert.equal(summary.distinctStacks, 2)
  const afterRemove = store.removeFromInventory(card.scryfallId, 'foil')
  assert.equal(afterRemove?.quantity, 0, 'foil stack should hit zero')
  assert.equal(store.listInventory().distinctStacks, 1, 'zero-quantity row should be deleted')
  console.log('inventory ok: add → increment → foil stack → remove-at-zero all behave')

  // Scan log: each add records a UTC timestamp + scan-time price; removes
  // retract the newest events; the inventory listing surfaces the latest.
  const listed = store.listInventory().items.find((i) => i.scryfallId === card.scryfallId)
  assert(listed, 'added card missing from listing')
  assert(
    listed.lastScannedAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(listed.lastScannedAt),
    `lastScannedAt not UTC ISO: ${listed.lastScannedAt}`
  )
  if (card.pricesUsd != null) {
    assert.equal(listed.lastPrice, card.pricesUsd, 'lastPrice should match scan-time price')
  }
  if (card.pricesEur != null) {
    assert.equal(
      listed.lastPriceEur,
      card.pricesEur,
      'lastPriceEur should match scan-time Cardmarket price'
    )
  }
  console.log(
    `scan log ok: ${listed.lastScannedAt} @ ${listed.lastPrice ?? '—'} USD / €${listed.lastPriceEur ?? '—'} Cardmarket`
  )

  // Exports: CSV (qty,name,set,collector) and plain list (1 Name (SET) 123).
  const csv = store.exportText('csv', 'all')
  assert(
    csv.split('\n').some((l) => /^2,The One Ring,ltr,246,\d{4}-\d{2}-\d{2}$/.test(l)),
    `unexpected CSV: ${csv}`
  )
  const list = store.exportText('list', 'all')
  assert(list.split('\n').includes('2 The One Ring (LTR) 246'), `unexpected list: ${list}`)
  console.log(`export ok: "${csv.split('\n')[0]}" / "${list.split('\n')[0]}"`)

  // Cardmarket (EUR) prices must have been imported from the bulk data.
  const eurCard = store.lookup('ltr', '246')!
  assert(eurCard.pricesEur != null && eurCard.pricesEur > 0, 'The One Ring has no EUR price')
  console.log(`cardmarket ok: The One Ring → €${eurCard.pricesEur}`)

  // Viewer server: boot on loopback, hit every endpoint, assert shapes.
  const viewerUrl = await openInventoryViewer(store)
  try {
    const inv = (await (await fetch(`${viewerUrl}api/inventory`)).json()) as {
      cards: { name: string; quantity: number; priceEur: number | null }[]
      totalCards: number
      totalValueEur: number
    }
    assert.equal(inv.totalCards, 2, `viewer inventory totalCards: ${inv.totalCards}`)
    const ring = inv.cards.find((c) => c.name === 'The One Ring')
    assert(ring && ring.quantity === 2, 'viewer inventory missing The One Ring ×2')
    assert(ring!.priceEur != null, 'viewer inventory row has no EUR price')
    assert(inv.totalValueEur > 0, 'viewer totalValueEur should be > 0')

    const sets = (await (await fetch(`${viewerUrl}api/sets?mode=inventory`)).json()) as {
      code: string
      count: number
    }[]
    assert(sets.some((s) => s.code === 'ltr' && s.count === 2), 'viewer sets missing ltr ×2')

    const anyResp = (await (
      await fetch(`${viewerUrl}api/cards?name=lightning%20bolt`)
    ).json()) as {
      cards: { name: string; priceEur: number | null; quantity: number }[]
      total: number
    }
    const anyCards = anyResp.cards
    assert(anyCards.length > 0, 'any-card search returned nothing')
    assert(anyResp.total >= anyCards.length, 'paged total smaller than page')
    assert(anyCards.every((c) => c.name.toLowerCase().includes('lightning')), 'bad search hit')
    assert(anyCards.some((c) => c.priceEur != null), 'no EUR prices in any-card results')

    const page = await (await fetch(viewerUrl)).text()
    assert(page.includes('MTG CardVault'), 'viewer page did not render')
    console.log(
      `viewer ok: ${inv.totalCards} cards €${inv.totalValueEur.toFixed(2)} · ` +
        `${sets.length} set(s) · "lightning bolt" → ${anyCards.length} printings`
    )
  } finally {
    closeInventoryViewer()
  }

  console.log('\nAll checks passed ✅')
} finally {
  store.close()
  fs.rmSync(scratchDir, { recursive: true, force: true })
}
