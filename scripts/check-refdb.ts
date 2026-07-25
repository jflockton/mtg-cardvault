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
      raw: ''
    })
    assert.equal(res.kind, 'exact', `old-frame resolve: expected exact, got ${res.kind}`)
    assert.equal(res.card!.setCode, 'mor', `old-frame resolve landed on ${res.card!.setCode}`)
    console.log(`resolve ok: 13/150 + ©2008 → ${res.card!.name} (MOR #13)`)
  } else {
    console.log('resolve skipped: no set metadata in this DB')
  }

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

  console.log('\nAll checks passed ✅')
} finally {
  store.close()
  fs.rmSync(scratchDir, { recursive: true, force: true })
}
