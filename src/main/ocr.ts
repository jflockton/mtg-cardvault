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
 * we stop at the first variant that yields a usable parse.
 */
export async function scanCorner(
  imageVariants: string[],
  langPath: string
): Promise<CornerScan> {
  const worker = await getWorker(langPath)
  const started = Date.now()

  let best: CornerScan | null = null
  for (let i = 0; i < imageVariants.length; i++) {
    const { data } = await worker.recognize(dataUrlToBuffer(imageVariants[i]))
    const parse = parseCornerText(data.text ?? '')
    const scan: CornerScan = {
      parse,
      confidence: data.confidence ?? 0,
      variant: i,
      ms: Date.now() - started
    }
    // Usable = we read a collector number (with a set code or a total),
    // or at least a set code to pair with a retry.
    if (parse.number && (parse.setCode || parse.total)) return scan
    if (!best || (parse.number ? 1 : 0) > (best.parse.number ? 1 : 0)) best = scan
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
