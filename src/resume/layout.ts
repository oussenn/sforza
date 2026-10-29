import { PAGE_HEIGHT } from './page'

/**
 * How a paginated CV sits on its pages, measured in the print page after pagination so the server (and the
 * agent writing the CV) can tell whether it fits: page count, how full the last page is, sections that run
 * over a page break, and empty space left at the bottom of a page by content pushed to the next one.
 */
export interface LayoutReport {
  pages: number
  /** share of the last page that holds content, 0–100 */
  lastPageFill: number
  /** titles of sections that run over a page break */
  split: string[]
  /** empty space at the bottom of a page because what follows moved to the next page */
  gaps: { page: number; column: string; mm: number; before: string }[]
  /** side-column sections alone on a page whose main column is already over: white space beside them */
  lonely: { page: number; sections: string[]; types: string[] }[]
}

/** How a motivation letter sits on paper: one A4 sheet that grows when the text runs long. */
export interface LetterFit {
  pages: number
  /** how far the letter runs past one page, in mm */
  overMm: number
}

const PX_PER_MM = 96 / 25.4
/** Empty space at a page bottom that counts as a gap: under everything, and under one of two columns. */
const MIN_GAP_MM = 12
const MIN_COLUMN_GAP_MM = 25

export function measureLayout(sheet: HTMLElement): LayoutReport {
  const H = PAGE_HEIGHT
  const origin = sheet.getBoundingClientRect().top
  const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth || 1
  const box = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { top: (r.top - origin) / scale, bottom: (r.bottom - origin) / scale }
  }
  const blocks = Array.from(sheet.querySelectorAll<HTMLElement>('[data-block]'))
    .map((el) => ({ el, ...box(el) }))
    .filter((b) => b.bottom - b.top > 0.5)
  const pageOf = (y: number) => Math.floor(y / H)
  const bottom = Math.max(0, ...blocks.map((b) => b.bottom))
  const pages = Math.max(1, Math.ceil((bottom - 1) / H))
  const band = (parseFloat(getComputedStyle(sheet).getPropertyValue('--my')) || 10) * PX_PER_MM

  const split: string[] = []
  for (const section of Array.from(sheet.querySelectorAll('section'))) {
    const own = blocks.filter((b) => section.contains(b.el))
    if (!own.length) continue
    const first = pageOf(Math.min(...own.map((b) => b.top)))
    const last = pageOf(Math.max(...own.map((b) => b.bottom)) - 1)
    if (last > first) split.push(section.querySelector('[data-heading]')?.textContent?.trim() || section.className)
  }

  // Empty space at the bottom of every page but the last, under all the content or under one column. A one-page CV
  // must fill its page, so there the last page counts too.
  const gaps: LayoutReport['gaps'] = []
  const colOf = (el: HTMLElement) => el.closest('[data-col]')
  const textOf = (el: HTMLElement | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  for (let p = 0; p < (pages === 1 ? 1 : pages - 1); p++) {
    const onPage = blocks.filter((b) => pageOf(b.top) === p)
    if (!onPage.length) continue
    const end = (p + 1) * H - band
    const next = blocks.find((b) => pageOf(b.top) > p)
    const pageFree = (end - Math.max(...onPage.map((b) => b.bottom))) / PX_PER_MM
    if (pageFree >= MIN_GAP_MM) {
      gaps.push({ page: p + 1, column: 'page', mm: Math.round(pageFree), before: textOf(next?.el) })
      continue
    }
    for (const col of new Set(onPage.map((b) => colOf(b.el)).filter((c): c is Element => !!c))) {
      const mine = onPage.filter((b) => colOf(b.el) === col)
      const bottom = Math.max(...mine.map((b) => b.bottom))
      // Full-width content below the column fills that space.
      if (onPage.some((b) => !colOf(b.el) && b.top >= bottom - 1)) continue
      const free = (end - bottom) / PX_PER_MM
      if (free >= MIN_COLUMN_GAP_MM) {
        const after = blocks.find((b) => pageOf(b.top) > p && (colOf(b.el) === col || !colOf(b.el)))
        gaps.push({ page: p + 1, column: col.getAttribute('data-col') ?? 'column', mm: Math.round(free), before: textOf(after?.el) })
      }
    }
  }

  // A side column that runs onto a page where its main column has nothing leaves that half of the page empty.
  const lonely: LayoutReport['lonely'] = []
  for (const side of Array.from(sheet.querySelectorAll<HTMLElement>('[data-col="side"]'))) {
    const main = Array.from(side.parentElement?.children ?? []).find((c) => c.getAttribute('data-col') === 'main')
    if (!main) continue
    const mainPages = new Set(blocks.filter((b) => main.contains(b.el)).map((b) => pageOf(b.top)))
    const sidePages = new Set(blocks.filter((b) => side.contains(b.el)).map((b) => pageOf(b.top)))
    for (const p of sidePages) {
      if (mainPages.has(p) || !mainPages.size) continue
      const sections = Array.from(side.querySelectorAll('section')).filter((s) => blocks.some((b) => s.contains(b.el) && pageOf(b.top) === p))
      lonely.push({
        page: p + 1,
        sections: sections.map((s) => s.querySelector('[data-heading]')?.textContent?.trim() || s.className),
        types: sections.map((s) => s.getAttribute('data-type') ?? '').filter(Boolean),
      })
    }
  }

  const lastPageFill = Math.round(Math.min(100, Math.max(0, ((bottom - (pages - 1) * H) / (H - band)) * 100)))
  return { pages, lastPageFill, split, gaps, lonely }
}

/**
 * The letter sheet is at least one page tall and grows with its text (its bottom margin included), so any height
 * past one page is text that prints on a second sheet.
 */
export function measureLetter(sheet: HTMLElement): LetterFit {
  const r = sheet.getBoundingClientRect()
  const scale = sheet.offsetWidth ? r.width / sheet.offsetWidth : 1
  const over = r.height / scale - PAGE_HEIGHT
  return { pages: over > 1 ? 1 + Math.ceil((over - 1) / PAGE_HEIGHT) : 1, overMm: Math.max(0, Math.round(over / PX_PER_MM)) }
}
