import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/**
 * Light / dark / system theme: the `dark` class on <html>, remembered in localStorage (per browser).
 * index.html applies it before the first paint; the /print page (PDF rendering) always stays light.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
const printing = () => window.location.pathname === '/print'

function stored(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

let choice = stored()

function resolved(): 'light' | 'dark' {
  if (printing()) return 'light'
  return choice === 'system' ? (media.matches ? 'dark' : 'light') : choice
}

function apply() {
  const dark = resolved() === 'dark'
  const root = document.documentElement
  if (root.classList.contains('dark') === dark) return
  // Switch every colour at once instead of animating each transition.
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(freeze)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  void getComputedStyle(document.body).opacity
  setTimeout(() => freeze.remove(), 0)
}

function changed() {
  apply()
  listeners.forEach((l) => l())
}

function commit(next: ThemeChoice) {
  choice = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  changed()
}

/** The theme button on screen (the menu button when the bar hides it), else the top right corner. */
function themeButton(): { x: number; y: number } {
  const visible = (el: Element | null) => (el && (el as HTMLElement).offsetParent !== null ? el.getBoundingClientRect() : null)
  const box = visible(document.querySelector('[data-theme-toggle]')) ?? visible(document.querySelector('[data-theme-menu]'))
  return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth - 28, y: 28 }
}

/**
 * Clip-path keyframes of an amoeba that grows from (x, y) until it covers the window: a polygon whose radius wobbles
 * with three waves, and the waves drift as it grows, so the edge keeps changing shape like a living cell. Its
 * narrowest point is 0.68 of the radius, so the last frame (radius = farthest corner / 0.66) covers every corner.
 */
function amoebaFrames(x: number, y: number): string[] {
  const w = window.innerWidth
  const h = window.innerHeight
  const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y))
  const seed = Math.random() * Math.PI * 2
  const POINTS = 200
  const STEPS = 20
  const frames: string[] = []
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS
    const r = (far / 0.66) * t
    const points: string[] = []
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2
      const k = 1 + 0.16 * Math.sin(3 * a + seed + t * 4) + 0.1 * Math.sin(5 * a - 1.7 * seed - t * 6) + 0.06 * Math.sin(7 * a + 0.6 * seed + t * 9)
      points.push(`${(x + Math.cos(a) * r * k).toFixed(1)}px ${(y + Math.sin(a) * r * k).toFixed(1)}px`)
    }
    frames.push(`polygon(${points.join(',')})`)
  }
  return frames
}

const resolvedFor = (next: ThemeChoice): 'light' | 'dark' => (printing() ? 'light' : next === 'system' ? (media.matches ? 'dark' : 'light') : next)

/**
 * Sets the theme. When it changes the colours, the new theme grows over the old one as an amoeba from `from` (the
 * theme button by default), through a view transition; without that browser feature, or with reduced motion
 * asked for, it switches at once.
 */
export function setTheme(next: ThemeChoice, from?: { x: number; y: number }) {
  const animate =
    resolvedFor(next) !== resolved() && typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!animate) {
    commit(next)
    return
  }
  const { x, y } = from ?? themeButton()
  const root = document.documentElement
  root.classList.add('theme-reveal')
  const transition = document.startViewTransition(() => flushSync(() => commit(next)))
  transition.ready
    .then(() =>
      root.animate({ clipPath: amoebaFrames(x, y) }, { duration: 950, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }),
    )
    .catch(() => undefined)
  void transition.finished.finally(() => root.classList.remove('theme-reveal'))
}

media.addEventListener('change', () => choice === 'system' && changed())
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  choice = stored()
  changed()
})
apply()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => choice)
  const current = useSyncExternalStore(subscribe, resolved)
  return { theme, resolved: current, setTheme }
}
