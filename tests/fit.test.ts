import { describe, expect, it } from 'vitest'
import { TEMPLATE_MAP } from '../shared/templates'
import type { ResumeStyle } from '../shared/types'
import { fitToPage } from '../src/resume/fit'
import type { LayoutReport } from '../src/resume/layout'

// A page model instead of a browser: text grows with font size and line height, gaps and margins add their own space,
// and a column's text grows as the column narrows. Heights in mm on a 297 mm page.
const PAGE = 297
const PX = 25.4 / 96
const base: ResumeStyle = { ...TEMPLATE_MAP.signature.style, fontSize: 10, lineHeight: 1.2, columnRatio: 50 }

const textHeight = (mm: number, st: ResumeStyle) => mm * (st.fontSize / 10) * (st.lineHeight / 1.2)
const spacing = (st: ResumeStyle) => 6 * st.sectionGap * PX + 12 * st.itemGap * PX + 2 * st.marginY

function report(height: number, columns: Record<string, number> = {}): LayoutReport {
  const pages = Math.max(1, Math.ceil(height / PAGE))
  const gaps: LayoutReport['gaps'] = []
  if (pages === 1 && PAGE - height >= 12) gaps.push({ page: 1, column: 'page', mm: Math.round(PAGE - height), before: '' })
  else if (pages === 1) {
    for (const [column, h] of Object.entries(columns)) if (height - h >= 25) gaps.push({ page: 1, column, mm: Math.round(height - h), before: '' })
  }
  return { pages, lastPageFill: Math.round(((height - (pages - 1) * PAGE) / PAGE) * 100), split: [], gaps, lonely: [] }
}

const oneColumn = (textMm: number) => async (st: ResumeStyle) => report(textHeight(textMm, st) + spacing(st))

/** Two columns; `ratioIsSide` puts the side column's width in columnRatio, as on sidebar templates. */
const twoColumns = (mainMm: number, sideMm: number, ratioIsSide = false) => async (st: ResumeStyle) => {
  const mainWidth = ratioIsSide ? 100 - st.columnRatio : st.columnRatio
  const main = textHeight(mainMm * (50 / mainWidth), st) + spacing(st)
  const side = textHeight(sideMm * (50 / (100 - mainWidth)), st) + spacing(st)
  return report(Math.max(main, side), { main, side })
}

const single = { columns: false, ratioIsSide: false, maxLineHeight: 1.4 }
const mixed = { columns: true, ratioIsSide: false, maxLineHeight: 1.25 }

describe('fitting a CV on one page', () => {
  it('fills one page with the roomiest spacing that still fits', async () => {
    const fit = await fitToPage(base, single, oneColumn(210))
    expect(fit.status).toBe('fits')
    expect(fit.layout.pages).toBe(1)
    expect(fit.layout.lastPageFill).toBeGreaterThanOrEqual(97)
    expect(fit.layout.gaps).toEqual([])
    expect(fit.style.fontSize).toBe(10)
  })

  it('takes a smaller font only when the tightest spacing still runs over, never below 9 pt', async () => {
    const fit = await fitToPage(base, single, oneColumn(315))
    expect(fit.status).toBe('fits')
    expect(fit.style.fontSize).toBeLessThan(10)
    expect(fit.style.fontSize).toBeGreaterThanOrEqual(9)
    expect(fit.layout.pages).toBe(1)

    const tooLong = await fitToPage(base, single, oneColumn(600))
    expect(tooLong.status).toBe('too_long')
    expect(tooLong.style.fontSize).toBe(9)
  })

  it('grows the font up to 11 pt for a short CV and says when the page still stays short', async () => {
    const grown = await fitToPage(base, single, oneColumn(140))
    expect(grown.style.fontSize).toBeGreaterThan(10)
    expect(grown.layout.lastPageFill).toBeGreaterThanOrEqual(95)

    const short = await fitToPage(base, single, oneColumn(60))
    expect(short.status).toBe('too_short')
    expect(short.style.fontSize).toBe(11)
  })

  it('narrows a column that ends early until it reaches the page bottom', async () => {
    const fit = await fitToPage(base, mixed, twoColumns(200, 150))
    expect(fit.style.columnRatio).toBeGreaterThan(50)
    expect(fit.layout.pages).toBe(1)
    expect(fit.layout.gaps).toEqual([])
  })

  it('moves the column width the other way when it sets the sidebar', async () => {
    const fit = await fitToPage(base, { ...mixed, ratioIsSide: true }, twoColumns(200, 150, true))
    expect(fit.style.columnRatio).toBeLessThan(50)
    expect(fit.layout.gaps).toEqual([])
  })
})
