import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { paletteVars, parsePalette, PALETTE_KEYS, type Palette } from './palette'

/**
 * Appearance, remembered in localStorage (per browser) and applied to <html>:
 *  - the theme (`data-look`): standard, sakura, terminal, space or custom (three colours of the user's own);
 *  - its contrast: light, dark or the system's (the `dark` class). Every theme has both contrasts;
 *  - motion effects (falling petals, stars, glyphs, bursts on clicks), on unless switched off or the system asks
 *    for reduced motion.
 * public/theme.js applies all of it before the first paint; the /print page (PDF rendering) always stays standard
 * and light.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type Look = 'standard' | 'sakura' | 'terminal' | 'space' | 'custom'
export const LOOKS: Look[] = ['standard', 'sakura', 'terminal', 'space', 'custom']

const KEY = 'theme'
const LOOK_KEY = 'look'
const PALETTE_KEY = 'palette'
/** The custom theme's tokens for both contrasts, for public/theme.js (which cannot compute them). */
const PALETTE_VARS_KEY = 'palette-vars'
const EFFECTS_KEY = 'effects'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const listeners = new Set<() => void>()
const printing = () => window.location.pathname === '/print'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

function storedChoice(): ThemeChoice {
  const t = read(KEY)
  return t === 'light' || t === 'dark' ? t : 'system'
}
export function parseLook(raw: string | null): Look {
  return LOOKS.includes(raw as Look) ? (raw as Look) : 'standard'
}
function storedPalette(): Palette {
  try {
    return parsePalette(JSON.parse(read(PALETTE_KEY) ?? 'null'))
  } catch {
    return parsePalette(null)
  }
}

let choice = storedChoice()
let look = parseLook(read(LOOK_KEY))
let palette = storedPalette()
let effects = read(EFFECTS_KEY) !== 'off'

function resolved(): 'light' | 'dark' {
  if (printing()) return 'light'
  return choice === 'system' ? (media.matches ? 'dark' : 'light') : choice
}
const resolvedLook = (): Look => (printing() ? 'standard' : look)
/** Effects actually running: on, not reduced motion, not the PDF page. */
const motion = () => effects && !reduceMotion.matches && !printing()

/** A snapshot for React, rebuilt only when something changes (useSyncExternalStore needs a stable value). */
export interface Appearance {
  theme: ThemeChoice
  resolved: 'light' | 'dark'
  look: Look
  palette: Palette
  effects: boolean
  /** effects are on and the system does not ask for reduced motion */
  motion: boolean
}
let snapshot: Appearance = build()
function build(): Appearance {
  return { theme: choice, resolved: resolved(), look: resolvedLook(), palette, effects, motion: motion() }
}

function apply() {
  const dark = resolved() === 'dark'
  const current = resolvedLook()
  const root = document.documentElement
  // Switch every colour at once instead of animating each transition.
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(freeze)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.look = current
  root.dataset.motion = motion() ? 'on' : 'off'
  const vars = current === 'custom' ? paletteVars(palette, dark ? 'dark' : 'light') : null
  for (const k of PALETTE_KEYS) {
    if (vars) root.style.setProperty(k, vars[k])
    else root.style.removeProperty(k)
  }
  void getComputedStyle(document.body).opacity
  setTimeout(() => freeze.remove(), 0)
}

function changed() {
  apply()
  snapshot = build()
  listeners.forEach((l) => l())
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

/**
 * Runs `change`; when it changes what the page looks like, the new look grows over the old one as an amoeba from
 * `from` (the theme button by default), through a view transition. Without that browser feature, or with reduced
 * motion asked for, it switches at once.
 */
function reveal(change: () => void, differs: boolean, from?: { x: number; y: number }) {
  const animate = differs && typeof document.startViewTransition === 'function' && !reduceMotion.matches
  if (!animate) {
    change()
    return
  }
  const { x, y } = from ?? themeButton()
  const root = document.documentElement
  root.classList.add('theme-reveal')
  const transition = document.startViewTransition(() => flushSync(change))
  transition.ready
    .then(() =>
      root.animate({ clipPath: amoebaFrames(x, y) }, { duration: 950, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }),
    )
    .catch(() => undefined)
  void transition.finished.finally(() => root.classList.remove('theme-reveal'))
}

const resolvedFor = (next: ThemeChoice): 'light' | 'dark' => (printing() ? 'light' : next === 'system' ? (media.matches ? 'dark' : 'light') : next)

/** The contrast: light, dark or the system's. */
export function setTheme(next: ThemeChoice, from?: { x: number; y: number }) {
  reveal(
    () => {
      choice = next
      write(KEY, next === 'system' ? null : next)
      changed()
    },
    resolvedFor(next) !== resolved(),
    from,
  )
}

/** The theme (standard, sakura, terminal, space or custom); each keeps the current contrast. */
export function setLook(next: Look, from?: { x: number; y: number }) {
  reveal(
    () => {
      look = next
      write(LOOK_KEY, next === 'standard' ? null : next)
      if (next === 'custom') storePaletteVars()
      changed()
    },
    next !== look,
    from,
  )
}

/** The custom theme's three colours; stored with the tokens they make, for the first paint of the next visit. */
export function setPalette(next: Palette) {
  palette = parsePalette(next)
  write(PALETTE_KEY, JSON.stringify(palette))
  storePaletteVars()
  changed()
}
const storePaletteVars = () => write(PALETTE_VARS_KEY, JSON.stringify({ light: paletteVars(palette, 'light'), dark: paletteVars(palette, 'dark') }))

export function setEffects(on: boolean) {
  effects = on
  write(EFFECTS_KEY, on ? null : 'off')
  changed()
}

media.addEventListener('change', () => choice === 'system' && changed())
reduceMotion.addEventListener('change', changed)
window.addEventListener('storage', (e) => {
  if (![KEY, LOOK_KEY, PALETTE_KEY, EFFECTS_KEY].includes(e.key ?? '')) return
  choice = storedChoice()
  look = parseLook(read(LOOK_KEY))
  palette = storedPalette()
  effects = read(EFFECTS_KEY) !== 'off'
  changed()
})
apply()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => snapshot)
}

export function useTheme() {
  const { theme, resolved: current } = useAppearance()
  return { theme, resolved: current, setTheme }
}
