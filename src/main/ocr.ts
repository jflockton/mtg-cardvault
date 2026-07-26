// Tesseract OCR on the card-corner crop. Runs in the main process (Node) so
// the traineddata loads from a plain file path and the renderer stays free of
// worker/wasm asset plumbing. Electron-free: langPath is injected.

import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import { parseCornerText, type CornerParse } from './cornerParse'

let workerPromise: Promise<Worker> | null = null
let configuredLangPath = ''

function getWorker(langPath: string): Promise<Worker> {
  if (!workerPromise || configuredLangPath !== langPath) {
    configuredLangPath = langPath
    workerPromise = (async () => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath,
        gzip: false,
        cacheMethod: 'none'
      })
      await worker.setParameters({
        // The corner is 2–3 short standalone lines, not a page.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1'
      })
      return worker
    })()
    workerPromise.catch(() => {
      workerPromise = null // allow retry after a failed init
    })
  }
  return workerPromise
}

export interface CornerScan {
  parse: CornerParse
  confidence: number
  /** Which of the supplied image variants produced the parse (for tuning). */
  variant: number
  ms: number
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

/**
 * OCR the corner crop. `imageVariants` are the same crop in different
 * polarities/preprocessing (renderer sends most-likely-correct first);
 * we stop at the first variant that yields a usable parse. If the block
 * pass reads nothing usable, retry in sparse-text mode — corner text is a
 * few scattered tokens, which PSM SINGLE_BLOCK sometimes glues into noise.
 */
export async function scanCorner(
  imageVariants: string[],
  langPath: string
): Promise<CornerScan> {
  const worker = await getWorker(langPath)
  const started = Date.now()

  const usable = (p: ReturnType<typeof parseCornerText>): boolean =>
    Boolean(p.number && (p.setCode || p.total))
  /** Prefer number+set/total, then number, then set code, then confidence. */
  const score = (s: CornerScan): number =>
    (usable(s.parse) ? 400 : 0) +
    (s.parse.number ? 200 : 0) +
    (s.parse.setCode ? 100 : 0) +
    s.confidence

  let best: CornerScan | null = null
  const passes: PSM[] = [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT]
  for (const psm of passes) {
    await worker.setParameters({ tessedit_pageseg_mode: psm })
    for (let i = 0; i < imageVariants.length; i++) {
      const { data } = await worker.recognize(dataUrlToBuffer(imageVariants[i]))
      const parse = parseCornerText(data.text ?? '')
      const scan: CornerScan = {
        parse,
        confidence: data.confidence ?? 0,
        variant: i,
        ms: Date.now() - started
      }
      if (usable(parse)) return scan
      if (!best || score(scan) > score(best)) best = scan
    }
  }
  return best!
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null)
    await w?.terminate()
    workerPromise = null
  }
}
