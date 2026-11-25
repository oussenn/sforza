import { useEffect, useRef } from 'react'
import { baseStage } from '@shared/utils'
import type { Stage } from '@shared/types'
import { Field, MONO, petalSprites, type Sprite } from '@/lib/fx'
import { useAppearance, type Look } from '@/lib/theme'

/**
 * The themes' motion effects in front of the app (a canvas that takes no clicks):
 *  - a click on a button, link, tab or menu item bursts from it: petals (sakura), glyphs (terminal), little stars
 *    (space), dots in the palette's colours (custom);
 *  - sakura: hovering a button of the top bar shakes a few petals off the sprig that blooms on its corner;
 *  - a board card being dragged sheds petals (stars, glyphs) from behind it, in the direction it came from, and
 *    sends a puff from under it where it lands; a card dropped on Offer brings a shower over its column.
 * The standard theme has none of it, and nothing runs with motion effects off or reduced motion asked for.
 */
export function Effects() {
  const { look, resolved, motion } = useAppearance()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!motion || look === 'standard' || !canvas.current) return
    const field = new Field(canvas.current)
    field.breeze = 6
    field.maxResting = 0
    let alive = true
    void sprites(look, resolved === 'dark').then((s) => alive && (field.sprites = s))
    const petals = look === 'sakura'
    const count = (n: number) => (petals ? n : Math.round(n * 1.2))

    const CLICKABLE = 'button, [role="button"], a[href], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="switch"], [role="option"], summary'
    const click = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(CLICKABLE)
      if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-no-fx]')) return
      const r = el.getBoundingClientRect()
      const keyboard = e.detail === 0 || (e.clientX === 0 && e.clientY === 0)
      const x = keyboard ? r.left + r.width / 2 : e.clientX
      const y = keyboard ? r.top + r.height / 2 : e.clientY
      field.burst(x, y, count(5), petals ? 0.85 : 1)
    }

    // Sakura: entering a top bar button shakes a petal or two off its sprig (top right corner).
    let hovered: Element | null = null
    const shaken = new WeakMap<Element, number>()
    const over = (e: PointerEvent) => {
      if (!petals || e.pointerType === 'touch') return
      const el = (e.target as Element | null)?.closest?.('[data-topbar] :is(button, a)') ?? null
      if (el === hovered) return
      hovered = el
      if (!el) return
      const now = performance.now()
      if (now - (shaken.get(el) ?? 0) < 1500) return
      shaken.set(el, now)
      const r = el.getBoundingClientRect()
      for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++)
        field.add({ x: r.right - 4 + Math.random() * 6, y: r.top + 2, vx: -20 + Math.random() * 50, vy: 20 + Math.random() * 30, size: 9 + Math.random() * 6, life: 2.4 + Math.random() * 1.2 })
    }

    // A dragged board card: where it was grabbed, how far it moved since the last petal.
    let drag: { w: number; h: number; ox: number; oy: number; x: number; y: number; travel: number } | null = null
    let dropStage: string | null = null
    const dragStart = (e: DragEvent) => {
      const card = (e.target as Element | null)?.closest?.('[data-card]')
      if (!card) return
      const r = card.getBoundingClientRect()
      drag = { w: r.width, h: r.height, ox: e.clientX - r.left, oy: e.clientY - r.top, x: e.clientX, y: e.clientY, travel: 0 }
      dropStage = null
      field.fromRect(r, count(5))
    }
    const dragOver = (e: DragEvent) => {
      if (!drag || (e.clientX === 0 && e.clientY === 0)) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.travel += Math.hypot(dx, dy)
      drag.x = e.clientX
      drag.y = e.clientY
      // One petal per ~48 px moved, from behind the edges of the card's picture, carried back the way it came.
      const rect = { left: e.clientX - drag.ox, top: e.clientY - drag.oy, width: drag.w, height: drag.h }
      while (drag.travel > 48) {
        drag.travel -= 48
        field.fromRect(rect, 1, { x: -dx * 1.6, y: -dy * 1.6 })
      }
    }
    const drop = (e: DragEvent) => {
      if (!drag) return
      dropStage = (e.target as Element | null)?.closest?.('[data-stage]')?.getAttribute('data-stage') ?? null
    }
    const dragEnd = (e: DragEvent) => {
      if (!drag) return
      const d = drag
      drag = null
      if (!dropStage) return
      const x = e.clientX || d.x
      const y = e.clientY || d.y
      const rect = { left: x - d.ox, top: y - d.oy, width: d.w, height: d.h }
      field.fromRect(rect, count(7), { x: 0, y: -40 })
      const stage = baseStage(dropStage as Stage)
      if (stage === 'offer' || stage === 'interview') {
        // A shower over the column it landed in: more for an offer.
        const col = document.querySelector(`[data-stage="${CSS.escape(dropStage)}"]`)?.getBoundingClientRect()
        const n = count(stage === 'offer' ? 20 : 8)
        for (let i = 0; i < n; i++) {
          const left = col ? col.left : x - 150
          const width = col ? col.width : 300
          field.add({ x: left + Math.random() * width, y: -10 - Math.random() * 160, vx: -30 + Math.random() * 60, vy: 40 + Math.random() * 60, life: 4.5 + Math.random() * 3 })
        }
      }
    }

    const move = (e: PointerEvent) => field.movePointer(e.clientX, e.clientY)
    let resizing = 0
    const resize = () => {
      clearTimeout(resizing)
      resizing = window.setTimeout(() => field.resize(), 150)
    }
    const vis = () => !document.hidden && field.resume()
    document.addEventListener('click', click, true)
    document.addEventListener('pointerover', over, true)
    document.addEventListener('dragstart', dragStart, true)
    document.addEventListener('dragover', dragOver, true)
    document.addEventListener('drop', drop, true)
    document.addEventListener('dragend', dragEnd, true)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      clearTimeout(resizing)
      field.stop()
      document.removeEventListener('click', click, true)
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('dragstart', dragStart, true)
      document.removeEventListener('dragover', dragOver, true)
      document.removeEventListener('drop', drop, true)
      document.removeEventListener('dragend', dragEnd, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [look, resolved, motion])

  if (!motion || look === 'standard') return null
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[70] print:hidden" />
}

/** The particles of each theme. Custom reads its own colours from the page. */
async function sprites(look: Look, dark: boolean): Promise<Sprite[]> {
  if (look === 'sakura') return petalSprites()
  if (look === 'terminal') return [{ kind: 'glyph', chars: '01<>/\\{}[]#$%&*+=_░▒▓', color: dark ? '#4dff88' : '#16793a', font: MONO }]
  if (look === 'space')
    return (dark ? ['#ffffff', '#cfc6ff', '#9ceaff', '#ffd9a8'] : ['#6b5be0', '#8f7df5', '#3fb6d9', '#f0a24b']).map((color) => ({ kind: 'star' as const, color }))
  const css = getComputedStyle(document.documentElement)
  return ['--primary', '--accent-foreground', '--ring'].map((v) => ({ kind: 'dot' as const, color: css.getPropertyValue(v).trim() || '#888' }))
}
