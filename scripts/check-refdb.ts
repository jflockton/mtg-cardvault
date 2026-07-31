// Sanity-check a built reference DB + exercise the DataStore end to end:
// random lookups, a name search, and an inventory add/increment/remove cycle
// against a throwaway inventory DB.
//
// Usage: npm run check:refdb [-- --data ./data]

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { DataStore } from '../src/main/store'

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
  console.log(`scan log ok: ${listed.lastScannedAt} @ ${listed.lastPrice ?? '—'} USD`)

  // CSV export: qty,name,set,collector — quantities summed across finishes.
  const csv = store.exportList()
  assert(csv.split('\n').includes('2,The One Ring,ltr,246'), `unexpected CSV: ${csv}`)
  console.log(`export ok: ${csv.split('\n')[0]}`)

  console.log('\nAll checks passed ✅')
} finally {
  store.close()
  fs.rmSync(scratchDir, { recursive: true, force: true })
}
