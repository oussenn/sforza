import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PAGE_HEIGHT, ResumeDocument, SHEET_WIDTH, type DocProps } from './ResumeDocument'

const GAP = 16

/**
 * Masks a gap out of the sheet at every page break, so whatever lies behind the preview (the backdrop) shows
 * between the pages. The drop shadow follows the mask: each page gets its own.
 */
function pageGaps(pages: number): string | undefined {
  if (pages < 2) return undefined
  const stops = Array.from({ length: pages - 1 }, (_, i) => {
    const at = (i + 1) * PAGE_HEIGHT
    return `#000 ${at - GAP / 2}px, transparent ${at - GAP / 2}px, transparent ${at + GAP / 2}px, #000 ${at + GAP / 2}px`
  })
  return `linear-gradient(#000 0, ${stops.join(', ')}, #000 100%)`
}

/** Scales the sheet to the available width and leaves gaps between pages. */
export function ResumePreview({
  className,
  maxScale = 1.25,
  padding = 24,
  onPages,
  ...doc
}: DocProps & { className?: string; maxScale?: number; padding?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const scale = width ? Math.max(0.2, Math.min(maxScale, (width - padding * 2) / SHEET_WIDTH)) : 0
  const handlePages = (n: number) => {
    setPages(n)
    onPages?.(n)
  }
  const mask = pageGaps(pages)

  return (
    <div ref={outer} className={cn('w-full', className)}>
      <div
        className="relative mx-auto"
        style={{ width: SHEET_WIDTH * scale, height: pages * PAGE_HEIGHT * scale, visibility: scale ? 'visible' : 'hidden' }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: SHEET_WIDTH,
            transform: `scale(${scale || 1})`,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.08)) drop-shadow(0 8px 20px rgba(0,0,0,0.1))',
          }}
        >
          <div style={{ maskImage: mask, WebkitMaskImage: mask }}>
            <ResumeDocument {...doc} onPages={handlePages} />
          </div>
        </div>
      </div>
    </div>
  )
}
