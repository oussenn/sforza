import { applyCuts, applyMoves, moveOptions, type Cut, type Move } from '@shared/shrink'
import type { ResumeContent, ResumeStyle } from '@shared/types'
import type { LayoutReport } from './layout'

/**
 * Fits a CV on exactly one page with as little empty space as possible, without touching its text. At the CV's own
 * font size (smaller only when it runs over, larger when the page stays empty, always 9–11 pt) it finds the roomiest
 * spacing (line height, gaps, top and bottom margins) that still keeps one page, and on two-column templates it widens
 * or narrows the column that ends early. The print page runs it against the real layout (window.__FIT): `measure`
 * renders one style and reports its layout.
 */
export interface FitResult {
  style: ResumeStyle
  layout: LayoutReport
  /** fits: one page; too_long: over a page even at the tightest readable setting; too_short: room left at the roomiest */
  status: 'fits' | 'too_long' | 'too_short'
  /** how many layouts were tried */
  tries: number
}

export interface FitOptions {
  /** two columns side by side, whose widths can balance their lengths */
  columns: boolean
  /** columnRatio is the width of the side column (sidebar templates), not of the main one */
  ratioIsSide: boolean
  /** line height at the roomiest spacing: lower for two narrow columns */
  maxLineHeight: number
}

const FIT_FONT = [9, 11] as const
/** fill of the page, in %, below which a larger font is tried */
const FULL = 95
/** how far the column width may move from the CV's own, in % */
const SWING = 15

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const to = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2))

/** The style at spacing `s`: 0 is the tightest readable setting, 1 the roomiest. */
function spaced(base: ResumeStyle, fontSize: number, columnRatio: number, s: number, maxLineHeight: number): ResumeStyle {
  return {
    ...base,
    fontSize,
    columnRatio,
    lineHeight: to(lerp(1.05, maxLineHeight, s), 0.01),
    sectionGap: Math.round(lerp(6, 22, s)),
    itemGap: Math.round(lerp(3, 14, s)),
    marginY: to(lerp(6, 14, s), 0.5),
  }
}

const columnGap = (l: LayoutReport) => l.gaps.find((g) => g.page === 1 && (g.column === 'main' || g.column === 'side'))
/** White space left on the first page: under everything and under a column. */
const emptyMm = (l: LayoutReport) => l.gaps.filter((g) => g.page === 1).reduce((n, g) => n + g.mm, 0)

export async function fitToPage(base: ResumeStyle, opts: FitOptions, measure: (style: ResumeStyle) => Promise<LayoutReport>): Promise<FitResult> {
  let tries = 0
  const run = (style: ResumeStyle) => {
    tries++
    return measure(style)
  }

  /** The roomiest spacing that keeps one page at this font size and column width. */
  const roomiest = async (font: number, ratio: number) => {
    const at = (s: number) => spaced(base, font, ratio, s, opts.maxLineHeight)
    const tight = await run(at(0))
    if (tight.pages > 1) return { style: at(0), layout: tight, s: 0, over: true }
    const roomy = await run(at(1))
    if (roomy.pages === 1) return { style: at(1), layout: roomy, s: 1, over: false }
    let best = { style: at(0), layout: tight, s: 0, over: false }
    let lo = 0
    let hi = 1
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      const layout = await run(at(mid))
      if (layout.pages === 1) {
        best = { style: at(mid), layout, s: mid, over: false }
        lo = mid
      } else hi = mid
    }
    return best
  }

  let font = clamp(to(base.fontSize, 0.5), ...FIT_FONT)
  let ratio = base.columnRatio
  let fit = await roomiest(font, ratio)
  while (fit.over && font > FIT_FONT[0]) {
    font -= 0.5
    fit = await roomiest(font, ratio)
  }
  if (fit.over) return { style: fit.style, layout: fit.layout, status: 'too_long', tries }
  while (fit.s === 1 && fit.layout.lastPageFill < FULL && font < FIT_FONT[1]) {
    const larger = await roomiest(font + 0.5, ratio)
    if (larger.over) break
    font += 0.5
    fit = larger
  }

  // A column that ends early: narrow it (it grows longer) and widen the other, by the smallest step that closes the gap.
  const gap = opts.columns ? columnGap(fit.layout) : undefined
  if (gap) {
    const step = (gap.column === 'side') !== opts.ratioIsSide ? 1 : -1
    const steps = Math.abs(clamp(ratio + step * SWING, 35, 70) - ratio)
    const stillShort = async (d: number) => {
      const layout = await run(spaced(base, font, ratio + step * d, fit.s, opts.maxLineHeight))
      return layout.pages === 1 && layout.gaps.some((g) => g.page === 1 && g.column === gap.column)
    }
    let d = steps
    if (steps && !(await stillShort(steps))) {
      let lo = 0
      while (d - lo > 1) {
        const mid = Math.floor((lo + d) / 2)
        if (await stillShort(mid)) lo = mid
        else d = mid
      }
    }
    if (d) {
      ratio += step * d
      const balanced = await roomiest(font, ratio)
      if (!balanced.over) fit = balanced
    }
  }

  const empty = fit.s === 1 && fit.layout.gaps.some((g) => g.column === 'page')
  return { style: fit.style, layout: fit.layout, status: empty ? 'too_short' : 'fits', tries }
}

/** What shrinkToPage changed on top of the style: sections moved to the other column, content hidden. */
export interface ShrinkResult extends FitResult {
  moves: Move[]
  cuts: Cut[]
}

/**
 * fitToPage for a CV that may change a little when spacing alone cannot keep it on one page: on two columns, first a
 * wider long column, then one section moved into the column that ends early; then (a tailored CV, `cuts` given) the
 * fewest cuts in `cuts`' order, taken only from the column that runs over, that let the tightest spacing hold one
 * page, and fitToPage on the result. A page that fits with a column ending early gets one section moved into it,
 * kept only when the page gets fuller.
 */
export async function shrinkToPage(
  base: ResumeStyle,
  content: ResumeContent,
  opts: FitOptions,
  measure: (style: ResumeStyle, content: ResumeContent) => Promise<LayoutReport>,
  cuts: Cut[],
): Promise<ShrinkResult> {
  let tries = 0
  const fit = async (style: ResumeStyle, c: ResumeContent) => {
    const f = await fitToPage(style, opts, (st) => measure(st, c))
    tries += f.tries
    return f
  }
  const sideOf = (l: LayoutReport) => {
    const gap = opts.columns ? columnGap(l) : undefined
    return gap && (gap.column === 'main' || gap.column === 'side') ? gap.column : undefined
  }
  /** A fitting page whose column ends early: one section from the other column moved into it, when that fills the page better. */
  const fillColumn = async (style: ResumeStyle, c: ResumeContent, f: FitResult) => {
    let best = { f, moves: [] as Move[] }
    const into = sideOf(f.layout)
    if (!into) return best
    for (const move of moveOptions(c, into).slice(0, 3)) {
      const g = await fit(style, applyMoves(c, [move]))
      if (g.status !== 'too_long' && emptyMm(g.layout) < emptyMm(best.f.layout) - 10) best = { f: g, moves: [move] }
    }
    return best
  }

  const first = await fit(base, content)
  if (first.status !== 'too_long') {
    const filled = await fillColumn(base, content, first)
    return { ...filled.f, tries, moves: filled.moves, cuts: [] }
  }

  // The tightest readable setting: does this content hold one page at all?
  const tight = async (style: ResumeStyle, c: ResumeContent) => {
    tries++
    return measure(spaced(style, FIT_FONT[0], style.columnRatio, 0, opts.maxLineHeight), c)
  }
  const holds = async (style: ResumeStyle, c: ResumeContent) => (await tight(style, c)).pages === 1
  let style = base
  let now = content
  const moves: Move[] = []
  const roomy = sideOf(first.layout)
  if (roomy) {
    const step = (roomy === 'side') !== opts.ratioIsSide ? 1 : -1
    const ratio = clamp(base.columnRatio + step * SWING, 35, 70)
    if (ratio !== base.columnRatio && (await holds({ ...base, columnRatio: ratio }, now))) style = { ...base, columnRatio: ratio }
    else {
      for (const move of moveOptions(now, roomy)) {
        const moved = applyMoves(now, [move])
        if (await holds(style, moved)) {
          now = moved
          moves.push(move)
          break
        }
      }
    }
    if (style !== base || moves.length) {
      const balanced = await fit(style, now)
      if (balanced.status !== 'too_long') return { ...balanced, tries, moves, cuts: [] }
    }
  }

  // The fewest cuts per column, each in `cuts`' order: a column that already fits loses nothing, and the long one only
  // what it needs. Main (with full-width sections) first while the side keeps every cut, then the side.
  if (!cuts.length || !(await holds(style, applyCuts(now, cuts)))) return { ...first, tries, moves: [], cuts: [] }
  const inSide = new Set(now.sections.flatMap((s) => (s.type !== 'summary' && s.placement === 'side' && opts.columns ? s.items.map((i) => i.id) : [])))
  const groups = [cuts.filter((c) => !inSide.has(c.item)), cuts.filter((c) => inSide.has(c.item))]
  const taken = groups.map((g) => g.length)
  const pick = () => groups.flatMap((g, i) => g.slice(0, taken[i]))
  for (let gi = 0; gi < groups.length; gi++) {
    // Smallest k with one page: f(lo) runs over, f(hi) holds (f(length) holds: every cut is in).
    taken[gi] = 0
    if (await holds(style, applyCuts(now, pick()))) continue
    let lo = 0
    let hi = groups[gi].length
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      taken[gi] = mid
      if (await holds(style, applyCuts(now, pick()))) hi = mid
      else lo = mid
    }
    taken[gi] = hi
  }
  const kept = new Set(pick())
  const chosen = cuts.filter((c) => kept.has(c))
  const cut = applyCuts(now, chosen)
  const filled = await fillColumn(style, cut, await fit(style, cut))
  return { ...filled.f, tries, moves: [...moves, ...filled.moves], cuts: chosen }
}
