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
  /** Word-level confidence of the token the collector number came from. */
  numberConf: number | null
  /** Word-level confidence of the token the set code came from. */
  setConf: number | null
  /** Which of the supplied image variants produced the parse (for tuning). */
  variant: number
  ms: number
}

interface OcrWord {
  text: string
  confidence: number
}

/** Flatten tesseract's block tree into words; shapes vary, so walk defensively. */
function collectWords(data: unknown): OcrWord[] {
  const words: OcrWord[] = []
  const blocks = (data as { blocks?: unknown }).blocks
  if (!Array.isArray(blocks)) return words
  for (const block of blocks) {
    for (const para of (block as { paragraphs?: unknown[] }).paragraphs ?? []) {
      for (const line of (para as { lines?: unknown[] }).lines ?? []) {
        for (const w of (line as { words?: unknown[] }).words ?? []) {
          const word = w as { text?: string; confidence?: number }
          if (word.text) words.push({ text: word.text, confidence: word.confidence ?? 0 })
        }
      }
    }
  }
  return words
}

function deconfuse(s: string): string {
  return s.replace(/[OoQ]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
}

/** Confidence of the word that plausibly produced the parsed number. */
function numberConfidence(words: OcrWord[], number: string): number | null {
  let best: number | null = null
  for (const w of words) {
    const cleaned = deconfuse(w.text.replace(/[^A-Za-z0-9/]/g, ''))
    if (cleaned.replace(/\D/g, '').includes(number)) {
      best = best === null ? w.confidence : Math.max(best, w.confidence)
    }
  }
  return best
}

/** Confidence of the word matching the parsed set code. */
function setConfidence(words: OcrWord[], setCode: string): number | null {
  const target = setCode.toUpperCase()
  let best: number | null = null
  for (const w of words) {
    if (w.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === target) {
      best = best === null ? w.confidence : Math.max(best, w.confidence)
    }
  }
  return best
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
      const { data } = await worker.recognize(
        dataUrlToBuffer(imageVariants[i]),
        {},
        { text: true, blocks: true }
      )
      const parse = parseCornerText(data.text ?? '')
      const words = collectWords(data)
      const scan: CornerScan = {
        parse,
        confidence: data.confidence ?? 0,
        numberConf: parse.number ? numberConfidence(words, parse.number) : null,
        setConf: parse.setCode ? setConfidence(words, parse.setCode) : null,
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
