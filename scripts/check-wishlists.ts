// Exercises the wish list store against a throwaway data dir: create, add,
// duplicate refusal, remove, export lines, cascade on delete.
// better-sqlite3 here is built for Electron's ABI, so run this under Electron's
// own Node rather than the system one — bundle it first, then run it:
//   npx esbuild scripts/check-wishlists.ts --bundle --platform=node --format=cjs //     --external:better-sqlite3 --outfile=scripts/.check-wishlists.cjs
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/.check-wishlists.cjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DataStore } from '../src/main/store'
import { REF_SCHEMA } from '../src/main/refdb'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardvault-wish-'))

// A two-card reference DB, so the store has printings to join against.
const ref = new Database(path.join(dir, 'reference.db'))
ref.exec(REF_SCHEMA)
const insert = ref.prepare(
  `INSERT INTO scryfall_cards
     (scryfall_id, name, set_code, set_name, collector_number, rarity, type_line,
      mana_cost, colors, image_uri, prices_eur, prices_usd, layout, back_image_uri)
   VALUES (@id, @name, @set, @setName, @cn, @rarity, @type, '', '[]', @img, @eur, @usd, 'normal', NULL)`
)
insert.run({
  id: 'f35d0be0-19e3-417e-aabf-fbed1aefd73c',
  name: 'Norman Osborn // Green Goblin',
  set: 'spm',
  setName: "Marvel's Spider-Man",
  cn: '220',
  rarity: 'mythic',
  type: 'Legendary Creature',
  img: 'https://cards.scryfall.io/normal/front/f/3/norman.jpg',
  eur: 21.5,
  usd: 24.1
})
insert.run({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Kaldra Compleat',
  set: 'cmm',
  setName: 'Commander Masters',
  cn: '958',
  rarity: 'mythic',
  type: 'Legendary Artifact Creature',
  img: 'https://cards.scryfall.io/normal/front/k/a/kaldra.jpg',
  eur: 12.0,
  usd: 14.0
})
ref.close()

const store = new DataStore(dir)
const checks: [string, boolean, unknown][] = []
const check = (label: string, pass: boolean, detail?: unknown): void => {
  checks.push([label, pass, detail])
}

const list = store.createWishlist('  Spidey chase cards  ')
check('createWishlist trims the name', list.name === 'Spidey chase cards', list.name)
check('a new list is empty', list.cardCount === 0)

const norman = 'f35d0be0-19e3-417e-aabf-fbed1aefd73c'
const kaldra = 'aaaaaaaa-0000-0000-0000-000000000001'

const first = store.addCardToWishlist(list.id, norman)
check('first add succeeds', first.ok && !first.duplicate, first)
check('add reports the list name', first.listName === 'Spidey chase cards', first.listName)

const again = store.addCardToWishlist(list.id, norman)
check('same printing again is refused', !again.ok && again.duplicate, again)
check('duplicate still names the list', again.listName === 'Spidey chase cards', again.listName)

store.addCardToWishlist(list.id, kaldra)
const detail = store.getWishlist(list.id)!
check('list holds two cards, not three', detail.cards.length === 2, detail.cards.length)
check('newest addition sorts first', detail.cards[0].name === 'Kaldra Compleat', detail.cards[0].name)
check(
  'printing details join from reference.db',
  detail.cards[0].setCode === 'cmm' && detail.cards[0].collectorNumber === '958',
  [detail.cards[0].setCode, detail.cards[0].collectorNumber]
)
check('card art comes through', detail.cards[0].imageUri?.endsWith('kaldra.jpg') === true)
check('prices come through', detail.cards[0].priceEur === 12, detail.cards[0].priceEur)
check('nothing is owned yet', detail.cards.every((c) => c.owned === 0))

check(
  'export is Name (SET) number, newest first',
  store.wishlistExportText(list.id) ===
    'Kaldra Compleat (CMM) 958\nNorman Osborn // Green Goblin (SPM) 220',
  store.wishlistExportText(list.id)
)

const summaries = store.listWishlists()
check('the index counts the cards', summaries[0].cardCount === 2, summaries[0].cardCount)
check('tile art is the newest card', summaries[0].imageUri?.endsWith('kaldra.jpg') === true)

store.removeWishlistCard(detail.cards[0].rowId)
check('remove drops one card', store.getWishlist(list.id)!.cards.length === 1)

const readd = store.addCardToWishlist(list.id, kaldra)
check('a removed card can go back on', readd.ok && !readd.duplicate, readd)

store.renameWishlist(list.id, 'Chase cards')
check('rename sticks', store.getWishlist(list.id)!.name === 'Chase cards')

const second = store.createWishlist('Bulk buys')
store.addCardToWishlist(second.id, norman)
check('the same card can sit on two lists', store.getWishlist(second.id)!.cards.length === 1)
check('both lists are listed', store.listWishlists().length === 2)

store.deleteWishlist(list.id)
check('delete removes the list', store.getWishlist(list.id) === null)
check('the other list survives', store.getWishlist(second.id)!.cards.length === 1)
const audit = new Database(path.join(dir, 'inventory.db'), { readonly: true })
const orphans = (
  audit
    .prepare('SELECT COUNT(*) AS n FROM wishlist_cards WHERE wishlist_id = ?')
    .get(list.id) as { n: number }
).n
audit.close()
check('its cards cascade away', orphans === 0, orphans)

check('adding to a list that does not exist is refused', !store.addCardToWishlist(9999, norman).ok)
check('exporting an unknown list is empty', store.wishlistExportText(9999) === '')

store.close()

let failed = 0
for (const [label, pass, detail] of checks) {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  → ${JSON.stringify(detail)}`}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed === 0 ? 0 : 1)
