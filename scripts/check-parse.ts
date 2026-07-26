// Unit checks for the corner-text parser against real noisy OCR reads.
// No DB or OCR engine needed. Usage: npm run check:parse

import assert from 'node:assert'
import { parseCornerText } from '../src/main/cornerParse'

const cases: {
  name: string
  text: string
  expect: {
    setCode?: string | null
    number?: string | null
    total?: number | null
    year?: number | null
    token?: boolean
  }
}[] = [
  {
    // Real read from James's webcam, FIN (Final Fantasy) card, 2026-07-26:
    // rarity BEFORE the number, "O"/"S" digit confusion, FFI origin marker,
    // rules-text noise above the corner lines.
    name: 'FIN frame, noisy real-world read',
    text: '¥      es   —   .\nEquip 3      :\nCc O1S2. «=O Fi\nFIN @ EN &® Allsanomt Howoet',
    expect: { setCode: 'fin', number: '152' }
  },
  {
    name: 'old frame: fraction + copyright range',
    text: '13/150\nHoward Lyon\n™ & © 1993-2008 Wizards of the Coast',
    expect: { setCode: null, number: '13', total: 150, year: 2008 }
  },
  {
    // James's Idyllic Tutor (MOR #12): 2003–2014 frames put the fraction at
    // the END of the copyright line, bottom-right of the card.
    name: '2003-14 frame: fraction inside the legal line',
    text: 'Howard Lyon\n™ & © 1993-2008 Wizards of the Coast, Inc. 12/150',
    expect: { setCode: null, number: '12', total: 150, year: 2008 }
  },
  {
    name: 'modern frame: fraction + set line',
    text: '123/274 M\nM21 • EN',
    expect: { setCode: 'm21', number: '123', total: 274 }
  },
  {
    name: 'modern frame: zero-padded bare number',
    text: '0059 U\nMID • EN',
    expect: { setCode: 'mid', number: '59' }
  },
  {
    name: 'garbled set code still yields number/total',
    text: '123/274 M\nM2. EN',
    expect: { setCode: null, number: '123', total: 274 }
  },
  {
    name: 'glued rarity letter',
    text: 'C0152 FFI\nFIN ★ EN',
    expect: { setCode: 'fin', number: '152', token: false }
  },
  {
    // James's FIN Hero token: T marker → must resolve into tfin, not fin.
    name: 'token marker: separate T',
    text: 'T 0008 FFXIV\nFIN • EN',
    expect: { setCode: 'fin', number: '8', token: true }
  },
  {
    name: 'token marker: glued T',
    text: 'T0001 FFIV\nFIN • EN',
    expect: { setCode: 'fin', number: '1', token: true }
  },
  {
    name: 'rarity letter is not a token marker',
    text: 'C 0152 FFI\nFIN • EN',
    expect: { setCode: 'fin', number: '152', token: false }
  },
  {
    // Real LCI read from James's scan-debug.log: OCR merged the collector
    // column into the copyright line — the zero-padded number must survive.
    name: 'zero-padded number inside a merged legal line',
    text: 'wt 0398             ™ & © 2023 Wizards of the Coast\nLCi ¢ EN ADAM PAQUETTE',
    expect: { setCode: 'lci', number: '398', year: 2023 }
  },
  {
    name: 'letters alone can never fabricate a number',
    text: 'II l Howard Lyon\n© 2008 Wizards',
    expect: { number: null, year: 2008 }
  },
  {
    // Real Bone Picker read (scan-debug.log): numerator garbled, so the
    // printed total /269 must NOT become a collector number (phantom Forest).
    name: 'garbled numerator: bare total never leaks through',
    text: 'yos!/269 u\nAKH ¢ EN te YEONG-HAO HAN',
    expect: { setCode: 'akh', number: null }
  },
  {
    // Same card, cleaner frame: deconfusion recovers the real fraction.
    name: 'deconfused fraction from noisy read',
    text: 'wO8l/269  U\nAKH ¢ EN te YEONG-HAO HAN',
    expect: { setCode: 'akh', number: '81', total: 269 }
  },
  {
    name: 'copyright year is never the collector number',
    text: '™ & © 2015 Wizards of the Coast',
    expect: { number: null, year: 2015 }
  }
]

let failed = 0
for (const c of cases) {
  const got = parseCornerText(c.text)
  const problems: string[] = []
  for (const [key, want] of Object.entries(c.expect)) {
    const actual = got[key as keyof typeof got]
    if (actual !== want) problems.push(`${key}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`)
  }
  if (problems.length > 0) {
    failed++
    console.error(`✗ ${c.name}\n    ${problems.join('\n    ')}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

assert.equal(failed, 0, `${failed} parse case(s) failed`)
console.log('\nAll parse checks passed ✅')
