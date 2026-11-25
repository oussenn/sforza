import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Height of the peeking sheet: the handle, the title row and the top of the page. */
const PEEK = 148
/** The open sheet leaves this much of the page above it. */
const TOP_GAP = 40

/**
 * The page preview on phones and tablets, as a bottom sheet like an in-app browser opened from an ad: it peeks at the
 * bottom with the top of the page showing, follows the finger when dragged up or down, and settles at the peek,
 * half way or open (a flick carries it to the next stop). Tapping the handle opens or closes it; when open, the page
 * scrolls inside, and dragging down from its top pulls the sheet down again.
 */
export function PreviewSheet({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(0)
  const [shown, setShown] = useState(PEEK)
  const live = useRef(PEEK)
  const moved = useRef(false)

  // The open height follows the window (the address bar coming and going, rotation).
  useLayoutEffect(() => {
    const measure = () => setFull(Math.max(PEEK + 40, (window.visualViewport?.height ?? window.innerHeight) - TOP_GAP))
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])

  const stops = useCallback(() => [PEEK, Math.round(PEEK + (full - PEEK) * 0.5), full], [full])

  /** Places the sheet (and the shade behind it) at a visible height, without React, while a finger moves it. */
  const place = useCallback(
    (h: number, animate: boolean) => {
      live.current = h
      const el = sheet.current
      if (!el || !full) return
      el.style.transition = animate ? 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
      el.style.transform = `translateY(${full - h}px)`
      if (shade.current) {
        shade.current.style.transition = animate ? 'opacity 320ms ease' : 'none'
        shade.current.style.opacity = String(Math.max(0, Math.min(1, (h - PEEK) / (full - PEEK))) * 0.5)
      }
    },
    [full],
  )

  /** 0 peek, 1 half way, 2 open: kept when the window changes size. */
  const stop = useRef(0)
  const settle = useCallback(
    (h: number) => {
      stop.current = h <= PEEK ? 0 : h >= full ? 2 : 1
      place(h, true)
      setShown(h)
    },
    [place, full],
  )

  useLayoutEffect(() => {
    if (!full) return
    const h = stops()[stop.current]
    place(h, false)
    setShown(h)
  }, [full, place, stops])

  // Finger (and mouse) drags.
  useEffect(() => {
    const el = sheet.current
    if (!el || !full) return
    let start: { y: number; h: number; inBody: boolean; take: boolean | null } | null = null
    let last = { y: 0, t: 0, v: 0 }
    const open = () => live.current >= full - 1

    const begin = (y: number, target: EventTarget | null) => {
      const inBody = !!body.current?.contains(target as Node)
      // An open sheet with its page scrolled down: the finger scrolls the page.
      start = { y, h: live.current, inBody, take: open() && inBody && (body.current?.scrollTop ?? 0) > 0 ? false : null }
      last = { y, t: performance.now(), v: 0 }
      moved.current = false
    }
    const drag = (y: number): boolean => {
      if (!start || start.take === false) return false
      const dy = y - start.y
      if (start.take === null) {
        if (Math.abs(dy) < 6) return false
        // An open sheet takes the finger only to be pulled down from the top of its page.
        start.take = !(open() && start.inBody) || (dy > 0 && (body.current?.scrollTop ?? 0) <= 0)
        if (!start.take) return false
      }
      moved.current = true
      const now = performance.now()
      last = { y, t: now, v: now > last.t ? (y - last.y) / (now - last.t) : last.v }
      let h = start.h - dy
      // A little give past the ends.
      if (h > full) h = full + (h - full) * 0.2
      if (h < PEEK) h = PEEK - (PEEK - h) * 0.3
      place(h, false)
      return true
    }
    const end = () => {
      if (!start) return
      const took = start.take
      start = null
      if (!took) return
      const s = stops()
      const h = live.current
      // A flick (over 0.45 px/ms) goes to the next stop in its direction; otherwise the nearest stop.
      const next =
        last.v < -0.45 ? (s.find((x) => x > h + 4) ?? full) : last.v > 0.45 ? ([...s].reverse().find((x) => x < h - 4) ?? PEEK) : s.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a))
      settle(next)
    }

    const touchStart = (e: TouchEvent) => e.touches.length === 1 && begin(e.touches[0].clientY, e.target)
    const touchMove = (e: TouchEvent) => {
      if (drag(e.touches[0].clientY) && e.cancelable) e.preventDefault()
    }
    const mouseDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !(e.target as Element).closest('[data-sheet-handle]')) return
      begin(e.clientY, e.target)
      const move = (m: PointerEvent) => drag(m.clientY)
      const up = () => {
        end()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    el.addEventListener('touchstart', touchStart, { passive: true })
    el.addEventListener('touchmove', touchMove, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('pointerdown', mouseDown)
    return () => {
      el.removeEventListener('touchstart', touchStart)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('pointerdown', mouseDown)
    }
  }, [full, place, settle, stops])

  const isOpen = shown > PEEK
  useEffect(() => {
    if (!isOpen) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && settle(PEEK)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [isOpen, settle])
  // Closing it brings the page back to its top, ready to peek again.
  useEffect(() => {
    if (!isOpen && body.current) body.current.scrollTop = 0
  }, [isOpen])

  const toggle = () => {
    if (moved.current) return
    settle(isOpen ? PEEK : full)
  }

  return (
    <>
      <div ref={shade} aria-hidden onClick={() => settle(PEEK)} className={cn('fixed inset-0 z-30 bg-black opacity-0 lg:hidden', !isOpen && 'pointer-events-none')} />
      <div
        ref={sheet}
        role="region"
        aria-label={`Preview: ${title}`}
        className="ring-hairline fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-[22px] bg-[var(--preview-canvas)] shadow-[0_-10px_40px_rgba(0,0,0,0.22)] ring-1 lg:hidden"
        style={{ height: full || PEEK, transform: `translateY(${full ? full - shown : 0}px)`, visibility: full ? 'visible' : 'hidden' }}
      >
        <button
          type="button"
          data-sheet-handle
          data-no-fx
          onClick={toggle}
          aria-expanded={isOpen}
          className="flex shrink-0 cursor-grab touch-none flex-col items-stretch px-4 pt-2 pb-2 text-left outline-none select-none active:cursor-grabbing"
        >
          <span className="bg-foreground/25 mx-auto mb-2 h-1 w-10 rounded-full" />
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{title}</span>
              {subtitle && <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>}
            </span>
            <span className="bg-foreground/[0.07] grid size-7 shrink-0 place-items-center rounded-full">
              <ChevronUp className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
            </span>
          </span>
        </button>
        <div
          ref={body}
          className={cn('min-h-0 flex-1 overscroll-contain px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]', shown >= full - 1 ? 'overflow-y-auto' : 'overflow-hidden')}
        >
          {children}
        </div>
      </div>
    </>
  )
}
