// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { measureLayout, measureLetter } from '@/resume/layout'
import { PAGE_HEIGHT } from '@/resume/page'

/**
 * A sheet whose blocks report the given positions (jsdom has no layout). Positions are in mm from the top
 * of the sheet; pages are 297 mm tall with a 10 mm band at the bottom (--my).
 */
const MM = 96 / 25.4

type Block = { section: string; col?: 'main' | 'side'; top: number; bottom: number; heading?: boolean }

function sheetOf(blocks: Block[]) {
  const sheet = document.createElement('div')
  sheet.style.setProperty('--my', '10mm')
  Object.defineProperty(sheet, 'offsetWidth', { value: 794 })
  sheet.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 794, width: 794, height: 0, x: 0, y: 0, toJSON: () => ({}) })
  const cols = new Map<string, HTMLElement>()
  const sections = new Map<string, HTMLElement>()
  for (const b of blocks) {
    let parent: HTMLElement = sheet
    if (b.col) {
      if (!cols.has(b.col)) {
        const c = document.createElement('div')
        c.dataset.col = b.col
        sheet.appendChild(c)
        cols.set(b.col, c)
      }
      parent = cols.get(b.col)!
    }
    if (!sections.has(b.section)) {
      const s = document.createElement('section')
      parent.appendChild(s)
      sections.set(b.section, s)
    }
    const el = document.createElement('div')
    el.dataset.block = ''
    if (b.heading) el.dataset.heading = ''
    el.textContent = b.heading ? b.section : `${b.section} item`
    const top = b.top * MM
    const bottom = b.bottom * MM
    el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })
    sections.get(b.section)!.appendChild(el)
  }
  return sheet
}

const page2 = PAGE_HEIGHT / MM // 297 mm

describe('measureLayout: whole sections, no gap at a page bottom', () => {
  it('accepts a two-column layout: two full columns on page 1, full-width sections on page 2', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 66, heading: true },
        { section: 'Experience', col: 'main', top: 66, bottom: 275 },
        { section: 'Projects', col: 'side', top: 60, bottom: 66, heading: true },
        { section: 'Projects', col: 'side', top: 66, bottom: 200 },
        { section: 'Education', col: 'side', top: 205, bottom: 284 },
        { section: 'Skills', top: page2 + 12, bottom: page2 + 80, heading: true },
      ]),
    )
    expect(r.pages).toBe(2)
    expect(r.split).toEqual([])
    expect(r.gaps).toEqual([])
  })

  it('reports a section that runs over a page break', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', top: 20, bottom: 26, heading: true },
        { section: 'Experience', top: 26, bottom: 280 },
        { section: 'Experience', top: page2 + 12, bottom: page2 + 40 },
      ]),
    )
    expect(r.split).toEqual(['Experience'])
  })

  it('reports empty space at the bottom of a page', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', top: 20, bottom: 230 },
        { section: 'Skills', top: page2 + 12, bottom: page2 + 60 },
      ]),
    )
    expect(r.gaps).toHaveLength(1)
    expect(r.gaps[0]).toMatchObject({ page: 1, column: 'page' })
    expect(r.gaps[0].mm).toBeGreaterThan(40)
  })

  it('reports a column that ends far above the page bottom', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 240 },
        { section: 'Education', col: 'side', top: 60, bottom: 284 },
        { section: 'Skills', top: page2 + 12, bottom: page2 + 60 },
      ]),
    )
    expect(r.gaps).toEqual([expect.objectContaining({ page: 1, column: 'main' })])
  })

  it('reports a side-column section alone on a page whose main column is over', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 280 },
        { section: 'Education', col: 'side', top: 60, bottom: 282 },
        { section: 'Languages', col: 'side', top: page2 + 12, bottom: page2 + 30, heading: true },
        { section: 'Skills', top: page2 + 35, bottom: page2 + 80 },
      ]),
    )
    expect(r.lonely).toEqual([expect.objectContaining({ page: 2, sections: ['Languages'] })])
  })

  it('accepts side and main columns that both reach the next page', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 280 },
        { section: 'Experience', col: 'main', top: page2 + 12, bottom: page2 + 40 },
        { section: 'Languages', col: 'side', top: page2 + 12, bottom: page2 + 30, heading: true },
      ]),
    )
    expect(r.lonely).toEqual([])
  })

  it('does not count the last page of a longer CV', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', top: 20, bottom: 284 },
        { section: 'Skills', top: page2 + 12, bottom: page2 + 60 },
      ]),
    )
    expect(r).toMatchObject({ pages: 2, split: [], gaps: [], lonely: [] })
  })

  it('reports a one-page CV that does not fill its page', () => {
    const r = measureLayout(sheetOf([{ section: 'Experience', top: 20, bottom: 120 }]))
    expect(r.pages).toBe(1)
    expect(r.gaps).toEqual([expect.objectContaining({ page: 1, column: 'page' })])
  })

  it('reports a column that ends early on a one-page CV', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 284 },
        { section: 'Projects', col: 'side', top: 60, bottom: 230 },
      ]),
    )
    expect(r.gaps).toEqual([expect.objectContaining({ page: 1, column: 'side' })])
  })

  it('accepts a full one-page CV', () => {
    const r = measureLayout(
      sheetOf([
        { section: 'Experience', col: 'main', top: 60, bottom: 282 },
        { section: 'Projects', col: 'side', top: 60, bottom: 276 },
      ]),
    )
    expect(r).toMatchObject({ pages: 1, split: [], gaps: [], lonely: [] })
  })
})

describe('measureLetter: a letter fits on one page', () => {
  /** A letter sheet that renders the given height in mm (it is at least one page tall, like the real one). */
  function letterOf(heightMm: number) {
    const sheet = document.createElement('div')
    Object.defineProperty(sheet, 'offsetWidth', { value: 794 })
    const height = Math.max(PAGE_HEIGHT, heightMm * MM)
    sheet.getBoundingClientRect = () => ({ top: 0, bottom: height, left: 0, right: 794, width: 794, height, x: 0, y: 0, toJSON: () => ({}) })
    return sheet
  }

  it('accepts a letter that ends on its first page', () => {
    expect(measureLetter(letterOf(200))).toEqual({ pages: 1, overMm: 0 })
    expect(measureLetter(letterOf(297))).toEqual({ pages: 1, overMm: 0 })
  })

  it('reports how far a long letter runs onto the next page', () => {
    expect(measureLetter(letterOf(297 + 18))).toEqual({ pages: 2, overMm: 18 })
    expect(measureLetter(letterOf(297 * 2 + 5))).toEqual({ pages: 3, overMm: 297 + 5 })
  })
})
