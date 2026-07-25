// Download the Tesseract English traineddata (fast variant, ~4MB) into
// resources/tessdata/ so OCR runs fully offline. Gitignored; run once locally
// and in CI before packaging — the dir ships with the installer.

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata'
const dest = path.resolve('resources/tessdata/eng.traineddata')

if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
  console.log(`Already present: ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })
console.log(`Downloading ${URL}`)
const res = await fetch(URL)
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
await pipeline(
  Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
  fs.createWriteStream(dest)
)
console.log(`Saved ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`)
