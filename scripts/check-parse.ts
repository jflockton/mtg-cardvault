// Unit checks for the corner-text parser against real noisy OCR reads.
// No DB or OCR engine needed. Usage: npm run check:parse

import assert from 'node:assert'
import { parseCornerText } from '../src/main/cornerParse'

const cases: {
  name: string
  text: string
  expect: { setCode?: string | null; number?: string | null; total?: number | null; year?: number | null }
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
    expect: { setCode: 'fin', number: '152' }
  },
  {
    name: 'letters alone can never fabricate a number',
    text: 'II l Howard Lyon\n© 2008 Wizards',
    expect: { number: null, year: 2008 }
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
