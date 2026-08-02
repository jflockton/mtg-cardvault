// Deck analysis — pure, dependency-free, shared by the renderer (and reusable
// under Node for tests). All input comes from DeckCard rows; anything the
// reference DB couldn't resolve (no mana_cost / type_line) is skipped, never
// guessed. Reference.db has no cmc or oracle_text, so mana value is parsed from
// the mana_cost string and categories are derived from the type line only —
// functional buckets (Draw/Removal/Ramp) and token derivation are NOT possible
// here and are intentionally out of scope for this module.

import type { DeckCard } from './types'

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type ManaColor = (typeof COLORS)[number]

export const COLOR_NAMES: Record<ManaColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green'
}

/** Card-type categories, in resolution order (first match wins). */
const CATEGORY_ORDER: { needle: string; label: string }[] = [
  { needle: 'Land', label: 'Lands' },
  { needle: 'Creature', label: 'Creatures' },
  { needle: 'Planeswalker', label: 'Planeswalkers' },
  { needle: 'Battle', label: 'Battles' },
  { needle: 'Instant', label: 'Instants' },
  { needle: 'Sorcery', label: 'Sorceries' },
  { needle: 'Artifact', label: 'Artifacts' },
  { needle: 'Enchantment', label: 'Enchantments' }
]

export const CATEGORY_LABELS = [
  ...CATEGORY_ORDER.map((c) => c.label),
  'Other',
  'Unresolved'
]

/**
 * Type-line → category. Order matters: an "Artifact Land" is a Land, an
 * "Artifact Creature" is a Creature. Null type line (unresolved) → 'Unresolved'.
 */
export function deckCategory(typeLine: string | null): string {
  if (!typeLine) return 'Unresolved'
  for (const { needle, label } of CATEGORY_ORDER) {
    if (typeLine.includes(needle)) return label
  }
  return 'Other'
}

/**
 * Whether a card may be a commander from its type line alone (we have no oracle
 * text). Legendary Creatures qualify, as do Backgrounds (for the "choose a
 * Background" pairing). Legendary planeswalkers that read "can be your
 * commander" aren't detectable here, so they're intentionally excluded for now.
 */
export function canBeCommander(typeLine: string | null): boolean {
  if (!typeLine) return false
  if (typeLine.includes('Background')) return true
  return typeLine.includes('Legendary') && typeLine.includes('Creature')
}

/** Maximum commanders in any format (partners / background). */
export const MAX_COMMANDERS = 2

/** Split a mana cost string into its `{...}` symbols. `"{2}{U}{U}"` → ['2','U','U']. */
function manaSymbols(manaCost: string | null): string[] {
  if (!manaCost) return []
  const out: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(manaCost)) !== null) out.push(m[1])
  return out
}

/**
 * Converted mana value from the printed cost. Generic numbers add their value;
 * hybrid/phyrexian symbols with a digit (e.g. 2/U) use the digit, otherwise
 * count as 1; X counts as 0. Good enough for a curve — matches Scryfall's cmc
 * for the overwhelming majority of cards.
 */
export function manaValue(manaCost: string | null): number {
  let mv = 0
  for (const sym of manaSymbols(manaCost)) {
    if (/^\d+$/.test(sym)) {
      mv += Number(sym)
      continue
    }
    const digit = sym.match(/\d+/)
    if (digit) {
      mv += Number(digit[0])
      continue
    }
    if (sym === 'X' || sym === 'Y' || sym === 'Z') continue
    mv += 1 // a coloured / hybrid / phyrexian / snow pip
  }
  return mv
}

/** Coloured pips per colour in a cost. Hybrid symbols count toward each colour they name. */
export function colorPips(manaCost: string | null): Record<ManaColor, number> {
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const sym of manaSymbols(manaCost)) {
    for (const c of COLORS) {
      if (sym.includes(c)) pips[c] += 1
    }
  }
  return pips
}

/**
 * Hypergeometric P(at least one success) — drawing `draws` cards from a
 * `deckSize` deck holding `successes` copies. Computed as 1 − P(none), with an
 * iterative product so it stays exact for Commander-sized decks.
 */
export function hypergeomAtLeastOne(deckSize: number, successes: number, draws: number): number {
  if (successes <= 0 || draws <= 0 || deckSize <= 0) return 0
  if (successes >= deckSize) return 1
  const d = Math.min(draws, deckSize)
  let pNone = 1
  for (let i = 0; i < d; i++) {
    const remainingFails = deckSize - successes - i
    if (remainingFails <= 0) return 1
    pNone *= remainingFails / (deckSize - i)
  }
  return 1 - pNone
}

export interface CurveBucket {
  /** mana value, capped at 7 (which means "7 or more") */
  mv: number
  count: number
}

export interface ColorShare {
  color: ManaColor
  pips: number
  /** distinct cards whose cost includes this colour */
  cards: number
}

export interface CategoryOdds {
  label: string
  quantity: number
  /** P(≥1 in the opening hand), 0..1 */
  oddsOpening: number
}

export interface DeckStats {
  /** total main-deck + commander copies (the deck size odds are drawn from) */
  totalCards: number
  landCount: number
  spellCount: number
  unresolvedCount: number
  avgManaValue: number
  totalManaValue: number
  curve: CurveBucket[]
  colors: ColorShare[]
  /** colourless / generic pips (not attributed to a colour) */
  genericPips: number
  categories: CategoryOdds[]
  openingHand: number
}

/**
 * Roll a deck's cards up into the numbers the analysis panels show. Only
 * main-deck + commander cards count (sideboard/maybe are excluded). `opening`
 * is the opening-hand size for the draw-odds column (7 by default).
 */
export function computeDeckStats(cards: DeckCard[], opening = 7): DeckStats {
  const inDeck = cards.filter((c) => c.category === '' || c.category === 'commander')

  let totalCards = 0
  let landCount = 0
  let spellCount = 0
  let unresolvedCount = 0
  let totalManaValue = 0
  const curveCounts = new Array(8).fill(0) as number[]
  const colorPipTotals: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  const colorCardCounts: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  let genericPips = 0
  const catQty = new Map<string, number>()

  for (const card of inDeck) {
    const qty = card.quantity
    totalCards += qty
    const category = deckCategory(card.typeLine)
    catQty.set(category, (catQty.get(category) ?? 0) + qty)

    if (category === 'Unresolved') {
      unresolvedCount += qty
      continue
    }
    if (category === 'Lands') {
      landCount += qty
      continue
    }

    spellCount += qty
    const mv = manaValue(card.manaCost)
    totalManaValue += mv * qty
    curveCounts[Math.min(mv, 7)] += qty

    const pips = colorPips(card.manaCost)
    for (const c of COLORS) {
      if (pips[c] > 0) {
        colorPipTotals[c] += pips[c] * qty
        colorCardCounts[c] += qty
      }
    }
    const coloured = COLORS.reduce((n, c) => n + pips[c], 0)
    const generic = Math.max(0, mv - coloured)
    genericPips += generic * qty
  }

  const curve: CurveBucket[] = curveCounts.map((count, mv) => ({ mv, count }))
  const colors: ColorShare[] = COLORS.map((color) => ({
    color,
    pips: colorPipTotals[color],
    cards: colorCardCounts[color]
  }))

  const categories: CategoryOdds[] = CATEGORY_LABELS.filter((l) => catQty.has(l)).map((label) => {
    const quantity = catQty.get(label) ?? 0
    return {
      label,
      quantity,
      oddsOpening: hypergeomAtLeastOne(totalCards, quantity, opening)
    }
  })

  return {
    totalCards,
    landCount,
    spellCount,
    unresolvedCount,
    avgManaValue: spellCount > 0 ? totalManaValue / spellCount : 0,
    totalManaValue,
    curve,
    colors,
    genericPips,
    categories,
    openingHand: opening
  }
}
