import type { ResumeStyle } from '@shared/types'
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

export const FIT_FONT = [9, 11] as const
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
