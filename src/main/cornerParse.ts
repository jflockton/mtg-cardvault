// Parse the OCR text of a card's bottom-left corner into identifying fields.
// Layouts in the wild:
//
//   Modern (~2015+):   "0123/280 R"  or "0152 C"  or "C 0152 FFI"   ← collector
//                      "M21 • EN"    or "FIN ★ EN 🖌Artist"          ← set code
//                      (FIN prints rarity BEFORE the number and adds an
//                       origin marker like "FFI"; stars replace bullets on
//                       some promos — treat all separators loosely)
//
//   Older (1998–2014): "13/150"                                      ← number/total
//                      "™ & © 1993–2008 Wizards…"                    ← year only
//                      (no set code printed anywhere on the card)
//
// Pure functions, no I/O — easy to unit-test against noisy OCR strings.

export interface CornerParse {
  /** 3–5 char set code, lowercased, if a set line was read. */
  setCode: string | null
  /** Collector number (leading zeros stripped), if read. */
  number: string | null
  /** Printed total from "number/total", if present (older frames). */
  total: number | null
  /** Latest copyright year in the text (≈ the set's release year). */
  year: number | null
  /** Raw OCR text, for debugging/UI. */
  raw: string
}

/** Common OCR digit confusions, applied only to digit-candidate tokens. */
function deconfuseDigits(s: string): string {
  return s.replace(/[OoQ]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
}

const LANG_CODES = new Set([
  'EN', 'DE', 'FR', 'IT', 'ES', 'PT', 'JA', 'JP', 'KO', 'RU', 'ZH', 'CS', 'CT', 'PH', 'TW'
])

/** Words that OCR may read in the corner but can never be a set code. */
const SET_CODE_STOPWORDS = new Set([
  'THE', 'AND', 'LLC', 'INC', 'USA', 'ENG', 'ART', 'TM', 'WOTC', 'PRO'
])

/** Lines that are clearly the copyright/legal line, not collector info. */
function isLegalLine(line: string): boolean {
  return /©|™|WIZARDS|COAST|HASBRO/i.test(line) || /(?:19|20)\d{2}/.test(line)
}

export function parseCornerText(rawText: string): CornerParse {
  const raw = rawText.trim()
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let setCode: string | null = null
  let number: string | null = null
  let total: number | null = null
  let year: number | null = null

  // Copyright year: the LAST 4-digit 19xx/20xx in the whole text — ranges
  // print as "1993-2008" and the second year is the release year.
  const yearMatches = raw.match(/(?:19|20)\d{2}/g)
  if (yearMatches && yearMatches.length > 0) {
    const y = Number(yearMatches[yearMatches.length - 1])
    if (y >= 1993 && y <= 2100) year = y
  }

  // --- Set code: a 3–5 char alnum token adjacent to a language code.
  // "M21 • EN", "FIN ★ EN", "2XM · EN" — the separator OCRs as anything.
  for (const line of lines) {
    const m = line.toUpperCase().match(/\b([A-Z0-9]{3,5})\b[^A-Z0-9]{0,4}\b([A-Z]{2})\b/)
    if (
      m &&
      LANG_CODES.has(m[2]) &&
      !SET_CODE_STOPWORDS.has(m[1]) &&
      /[A-Z]/.test(m[1]) // pure numbers are never set codes
    ) {
      setCode = m[1].toLowerCase()
      break
    }
  }

  // --- Collector number, in priority order across all non-legal lines:
  //  1. fraction "13/150" (old frames — also yields the printed total)
  //  2. leading-zero token "0152" / "O152" (unambiguously a collector number)
  //  3. a standalone 1–4 digit token that isn't a year
  const contentLines = lines.filter((l) => !isLegalLine(l))

  for (const line of contentLines) {
    const frac = deconfuseDigits(line).match(/(\d{1,4})\s*\/\s*(\d{2,4})/)
    if (frac) {
      number = String(Number(frac[1]))
      total = Number(frac[2])
      break
    }
  }

  if (!number) {
    for (const line of contentLines) {
      // Tokens like "0152", "O1S2", "0152a" — possibly glued to a rarity
      // letter ("C0152"). Leading zero makes these safe to trust anywhere in
      // the line (years and totals never start with 0). Deconfuse BEFORE
      // stripping any rarity letter: in "O1S2" the leading O *is* the zero.
      const tokens = line.split(/[^A-Za-z0-9]+/)
      for (const t of tokens) {
        const d = deconfuseDigits(t)
        for (const candidate of [d, d.replace(/^[A-Za-z]+/, '')]) {
          const m = candidate.match(/^0(\d{2,3})[a-z]?$/i)
          if (m) {
            number = String(Number(m[1]))
            break
          }
        }
        if (number) break
      }
      if (number) break
    }
  }

  if (!number) {
    for (const line of contentLines) {
      const tokens = line.split(/[^A-Za-z0-9]+/)
      for (const t of tokens) {
        // Must contain at least one true digit pre-deconfusion, so "II"/"l"
        // can't fabricate a collector number out of letters.
        if (t.length < 2 || !/\d/.test(t)) continue
        if (!/^\d{1,4}$/.test(deconfuseDigits(t))) continue
        const n = Number(deconfuseDigits(t))
        // Reject year-like and total-like context; totals only appear in
        // fractions, which were handled above.
        if (n > 0 && (n < 1900 || n > 2099)) {
          number = String(n)
          break
        }
      }
      if (number) break
    }
  }

  return { setCode, number, total, year, raw }
}
