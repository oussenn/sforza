import type { TouchEvent as ReactTouchEvent } from 'react'

/**
 * Moving board cards with a finger (touch screens have no HTML drag and drop): hold a card for a moment until it
 * lifts, then drag it to another column or place; near the edges of the board it scrolls along. A finger that moves
 * before the card lifts scrolls the board as usual, and a short tap still opens the card.
 * The effects layer hears about it through `carddrag` events on window (detail: phase, x, y, card, stage).
 */

const HOLD_MS = 280
const SLOP = 8
const EDGE = 56
const MAX_SPEED = 9

export interface TouchDragHandlers {
  start: (id: string) => void
  over: (x: number, y: number) => void
  drop: () => string | null
  cancel: () => void
}

export type CardDragDetail = { phase: 'start' | 'move' | 'end'; x: number; y: number; card?: Element; stage?: string | null }
const emit = (detail: CardDragDetail) => window.dispatchEvent(new CustomEvent<CardDragDetail>('carddrag', { detail }))

let busy = false
/** A finger holds or drags a card: the browser's own drag (long press on some phones) must not start too. */
export const touchDragBusy = () => busy

export function startTouchDrag(e: ReactTouchEvent<HTMLElement>, id: string, scroller: HTMLElement | null, h: TouchDragHandlers) {
  if (e.touches.length !== 1 || busy) return
  const target = e.target as Element
  // The card's own buttons and links keep their tap; the invisible button that opens the card does not count.
  const control = target.closest('a, button, [role="button"], input, textarea')
  if (control && !control.hasAttribute('data-card-open')) return
  const card = e.currentTarget
  const t0 = e.touches[0]
  const origin = { x: t0.clientX, y: t0.clientY }
  let point = { ...origin }
  let active = false
  let ghost: HTMLElement | null = null
  let rect: DOMRect | null = null
  let frame = 0
  let snap = ''
  busy = true

  const lift = () => {
    active = true
    // A short buzz as the card lifts (phones only allow it once the page has been tapped).
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12)
    rect = card.getBoundingClientRect()
    ghost = card.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-card')
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      margin: '0',
      zIndex: '60',
      pointerEvents: 'none',
      boxShadow: '0 18px 40px rgba(0,0,0,0.25)',
      transform: 'scale(1.04) rotate(1.5deg)',
      transition: 'transform 120ms ease',
      opacity: '0.96',
    })
    document.body.appendChild(ghost)
    if (scroller) {
      snap = scroller.style.scrollSnapType
      scroller.style.scrollSnapType = 'none'
      scroller.style.scrollBehavior = 'auto'
    }
    h.start(id)
    emit({ phase: 'start', x: point.x, y: point.y, card })
    frame = requestAnimationFrame(scroll)
  }
  const timer = window.setTimeout(lift, HOLD_MS)

  // Near an edge of the board, it scrolls that way, faster the closer the finger.
  const scroll = () => {
    if (!active) return
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      const speed = (d: number) => (d < EDGE ? Math.round(MAX_SPEED * (1 - Math.max(0, d) / EDGE)) : 0)
      const dx = speed(r.right - point.x) - speed(point.x - r.left)
      const dy = speed(r.bottom - point.y) - speed(point.y - r.top)
      if (dx || dy) {
        scroller.scrollBy(dx, dy)
        h.over(point.x, point.y)
      }
    }
    frame = requestAnimationFrame(scroll)
  }

  const move = (ev: TouchEvent) => {
    const t = ev.touches[0]
    if (!t) return
    point = { x: t.clientX, y: t.clientY }
    if (!active) {
      if (Math.hypot(point.x - origin.x, point.y - origin.y) > SLOP) finish(false)
      return
    }
    if (ev.cancelable) ev.preventDefault()
    if (ghost && rect) ghost.style.transform = `translate(${point.x - origin.x}px, ${point.y - origin.y}px) scale(1.04) rotate(1.5deg)`
    h.over(point.x, point.y)
    emit({ phase: 'move', x: point.x, y: point.y })
  }
  const up = () => finish(true)
  const cancel = () => finish(false)
  const menu = (ev: Event) => ev.preventDefault()

  function finish(drop: boolean) {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    document.removeEventListener('touchmove', move)
    document.removeEventListener('touchend', up)
    document.removeEventListener('touchcancel', cancel)
    window.removeEventListener('contextmenu', menu, true)
    busy = false
    if (!active) return
    active = false
    ghost?.remove()
    if (scroller) {
      scroller.style.scrollSnapType = snap
      scroller.style.scrollBehavior = ''
    }
    const stage = drop ? h.drop() : (h.cancel(), null)
    emit({ phase: 'end', x: point.x, y: point.y, stage })
    // The lifted finger must not also open the card.
    const swallow = (ev: Event) => {
      ev.preventDefault()
      ev.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 450)
  }

  document.addEventListener('touchmove', move, { passive: false })
  document.addEventListener('touchend', up)
  document.addEventListener('touchcancel', cancel)
  // A long press would open the phone's menu for the card's text or logo.
  window.addEventListener('contextmenu', menu, true)
}
