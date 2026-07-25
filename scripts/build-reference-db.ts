// Build the Scryfall reference DB outside Electron (plain Node).
// Used for: (a) local dev — populate ./data so `npm run dev` has lookups,
// (b) CI — build resources/reference.db that gets bundled into installers.
//
// Usage:
//   npm run build:refdb                 → ./data/reference.db
//   npm run build:refdb -- --out resources/reference.db
//
// NOTE: requires better-sqlite3 compiled for Node (the default after
// `npm install`). If you've run `npm run rebuild:electron`, switch back
// with `npm run rebuild:node` first.

import path from 'node:path'
import fs from 'node:fs'
import { buildReferenceDb } from '../src/main/refdb'

const outArgIdx = process.argv.indexOf('--out')
const outPath = path.resolve(
  outArgIdx !== -1 ? process.argv[outArgIdx + 1] : path.join('data', 'reference.db')
)
const workDir = path.join(path.dirname(outPath), 'bulk')
fs.mkdirSync(path.dirname(outPath), { recursive: true })

console.log(`Building reference DB → ${outPath}`)

let lastLine = ''
const count = await buildReferenceDb(outPath, workDir, (p) => {
  let line = ''
  if (p.phase === 'listing') line = 'Fetching bulk data listing…'
  else if (p.phase === 'download')
    line = `Downloading ${((p.receivedBytes ?? 0) / 1e6).toFixed(0)} / ${((p.totalBytes ?? 0) / 1e6).toFixed(0)} MB`
  else if (p.phase === 'import') line = `Importing ${p.imported?.toLocaleString()} cards`
  else if (p.phase === 'finalize') line = 'Finalising…'
  else if (p.phase === 'done') line = `Done — ${p.imported?.toLocaleString()} cards`
  else if (p.phase === 'error') line = `ERROR: ${p.message}`
  if (line && line !== lastLine) {
    lastLine = line
    console.log(line)
  }
})

console.log(`Reference DB built: ${count.toLocaleString()} printings.`)
