// Parse the OCR text of a card's bottom-left corner into identifying fields.
// Two printing eras matter:
//
//   Modern (~2015+, M15 frame):   "123/280 R"  or "0123 M"     ← collector line
//                                 "M21 • EN"                    ← set code line
//
//   Older (1998–2014):            "13/150"                      ← collector/total
//                                 "™ & © 1993–2008 Wizards…"    ← copyright year
//                                 (no set code printed anywhere on the card)
//
// Pure functions, no I/O — easy to unit-test against noisy OCR strings.

export interface CornerParse {
  /** 3–5 char set code, lowercased, if a modern set line was read. */
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

/** Common OCR digit confusions, applied only inside digit-ish tokens. */
function deconfuseDigits(s: string): string {
  return s.replace(/[OoQ]/g, '0').replace(/[Il|]/g, '1').replace(/[S]/g, '5').replace(/[B]/g, '8')
}

const LANG_CODES = new Set([
  'EN', 'DE', 'FR', 'IT', 'ES', 'PT', 'JA', 'JP', 'KO', 'RU', 'ZH', 'CS', 'CT', 'PH', 'TW'
])

/** Words that OCR may read in the corner but can never be a set code. */
const SET_CODE_STOPWORDS = new Set([
  'THE', 'AND', 'LLC', 'INC', 'USA', 'ENG', 'ART', 'TM', 'WOTC', 'PRO'
])

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

  // Copyright year: take the LAST 4-digit 19xx/20xx in the whole text —
  // ranges print as "1993-2008" and the second year is the release year.
  const yearMatches = raw.match(/(?:19|20)\d{2}/g)
  if (yearMatches && yearMatches.length > 0) {
    const y = Number(yearMatches[yearMatches.length - 1])
    if (y >= 1993 && y <= 2100) year = y
  }

  for (const line of lines) {
    // Set-code line: "M21 • EN", "ELD EN", "2XM · EN" — a 3–5 char alnum token
    // next to a language code (the bullet often OCRs as ., *, -, or noise).
    if (!setCode) {
      const setLine = line.toUpperCase().match(
        /\b([A-Z0-9]{3,5})\b[^A-Z0-9]{0,4}\b([A-Z]{2})\b/
      )
      if (
        setLine &&
        LANG_CODES.has(setLine[2]) &&
        !SET_CODE_STOPWORDS.has(setLine[1]) &&
        /[A-Z]/.test(setLine[1]) // pure numbers are never set codes
      ) {
        setCode = setLine[1].toLowerCase()
      }
    }

    // Collector line with printed total: "13/150", "013/280 R", "123 / 280".
    if (!number) {
      const frac = deconfuseDigits(line).match(/(\d{1,4})\s*\/\s*(\d{2,4})/)
      if (frac) {
        // Copyright years never appear as fractions; totals are 2–4 digits.
        number = String(Number(frac[1]))
        total = Number(frac[2])
        continue
      }
    }

    // Modern collector line without total: "0123", "0059 U", "123 M" —
    // a short standalone number, optionally followed by a rarity letter.
    if (!number) {
      const bare = deconfuseDigits(line).match(/^(\d{1,4})\s*[a-zA-Z]?$/)
      if (bare) {
        const n = Number(bare[1])
        // Reject year-like values so "2008" never becomes a collector number.
        if (n > 0 && (n < 1900 || n > 2099)) number = String(n)
      }
    }
  }

  return { setCode, number, total, year, raw }
}
