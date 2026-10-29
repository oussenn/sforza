/**
 * Simulates CSS paged media on a continuous A4-wide sheet.
 *
 * Every element marked `data-block` is atomic: if it would cross a page boundary (or start inside the
 * top/bottom margin band of a page) it is pushed down with an extra margin-top so it starts right below
 * the next page's top margin. Elements marked `data-keep` travel with the block that follows them
 * (section headings, entry headers). The same spacing is used for printing, so the browser's native
 * page breaks at every 297mm land inside empty bands and preview === PDF.
 */
export interface PageMetrics {
  /** page height in px (A4 = 297mm) */
  pageHeight: number
  /** reserved band at the top of pages 2+ (px) */
  top: number
  /** reserved band at the bottom of every page (px) */
  bottom: number
}

/** Entries up to this share of a page are kept on one page (`data-entry`); longer ones split between bullets. */
const ENTRY_KEEP = 0.4

export function paginate(sheet: HTMLElement, m: PageMetrics): number {
  const blocks = Array.from(sheet.querySelectorAll<HTMLElement>('[data-block]'))
  sheet.style.minHeight = ''
  for (const b of blocks) {
    if (b.dataset.pushed !== undefined) {
      b.style.marginTop = ''
      delete b.dataset.pushed
    }
    delete b.dataset.cont
  }

  const sheetRect = sheet.getBoundingClientRect()
  const scale = sheetRect.width / sheet.offsetWidth || 1
  const originTop = sheetRect.top
  const rect = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { top: (r.top - originTop) / scale, bottom: (r.bottom - originTop) / scale }
  }
  const column = (el: HTMLElement) => el.closest('[data-col]')
  const H = m.pageHeight
  const usable = H - m.top - m.bottom

  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    const { top, bottom } = rect(el)
    const height = bottom - top
    if (height <= 0.5) continue
    const page = Math.floor((top + 0.5) / H)
    const firstLine = page * H + (page > 0 ? m.top : 0)
    let target: number | null = null
    if (page > 0 && top < firstLine - 0.5) target = firstLine
    else if (bottom > (page + 1) * H - m.bottom + 0.5 && height <= usable) target = (page + 1) * H + m.top
    if (target === null) continue

    // A short entry (header and bullets) moves as a whole rather than leaving a stray bullet behind.
    let start = i
    const entry = el.closest<HTMLElement>('[data-entry]')
    if (entry) {
      const first = blocks.findIndex((b) => entry.contains(b))
      if (first >= 0 && first < i && bottom - rect(blocks[first]).top <= usable * ENTRY_KEEP) start = first
    }

    // Carry headings / entry headers along so they never end a page on their own.
    let j = start
    while (j > 0) {
      const prev = blocks[j - 1]
      if (prev.dataset.keep === undefined || column(prev) !== column(el)) break
      if (bottom - rect(prev).top > usable) break
      j--
    }
    const mover = blocks[j]
    const moverTop = rect(mover).top
    const delta = target - moverTop
    if (delta <= 0) continue
    const current = parseFloat(getComputedStyle(mover).marginTop) || 0
    mover.style.marginTop = `${current + delta}px`
    mover.dataset.pushed = ''
    // An entry that opens a page under a section title left on an earlier page repeats that title (base.css).
    const heading = mover.closest('section')?.querySelector<HTMLElement>('[data-heading]')
    if (heading && mover.dataset.keep !== undefined && !mover.contains(heading) && Math.floor(rect(heading).top / H) < Math.floor(target / H)) {
      mover.dataset.cont = heading.textContent?.trim() ?? ''
    }
    i = j
  }

  const contentHeight = sheet.scrollHeight
  const pages = Math.max(1, Math.ceil((contentHeight - 1) / H))
  // One pixel short of N pages so printing never spills onto an empty extra page.
  sheet.style.minHeight = `${pages * H - 1}px`
  return pages
}
