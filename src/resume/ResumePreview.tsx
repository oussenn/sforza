import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PAGE_HEIGHT, ResumeDocument, SHEET_WIDTH, type DocProps } from './ResumeDocument'

const GAP = 16

/** Scales the sheet to the available width and draws gaps between pages. */
export function ResumePreview({
  className,
  maxScale = 1.25,
  padding = 24,
  gapColor = 'var(--preview-canvas)',
  onPages,
  ...doc
}: DocProps & { className?: string; maxScale?: number; padding?: number; gapColor?: string }) {
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

  return (
    <div ref={outer} className={cn('w-full', className)}>
      <div
        className="relative mx-auto"
        style={{ width: SHEET_WIDTH * scale, height: pages * PAGE_HEIGHT * scale, visibility: scale ? 'visible' : 'hidden' }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_28px_rgba(0,0,0,0.08)]"
          style={{ width: SHEET_WIDTH, transform: `scale(${scale || 1})` }}
        >
          <ResumeDocument {...doc} onPages={handlePages} />
          {Array.from({ length: pages - 1 }, (_, i) => (
            <div
              key={i}
              aria-hidden
              className="pointer-events-none absolute -right-10 -left-10"
              style={{ top: (i + 1) * PAGE_HEIGHT - GAP / 2, height: GAP, background: gapColor }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
