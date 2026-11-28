import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { cleanAppearance, type AccountAppearance } from '@shared/appearance'
import { paletteVars, parsePalette, PALETTE_KEYS, type Palette } from './palette'

/**
 * Appearance, applied to <html>:
 *  - the theme (`data-look`): standard, sakura, terminal, space or custom (three colours of the user's own);
 *  - its contrast: light, dark or the system's (the `dark` class). Every theme has both contrasts;
 *  - motion effects (falling petals, stars, glyphs, bursts on clicks), on unless switched off or the system asks
 *    for reduced motion;
 *  - theme sounds: Sakura, Terminal and Space each play a short sound as they spread over the page.
 * Each account keeps its own on the server (shared/appearance.ts): EditorRoot adopts it on sign-in and saves every
 * change through setAppearanceSaver. localStorage caches the last one for public/theme.js, which applies it before
 * the first paint. The /print page (PDF rendering) always stays standard and light.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type Look = 'standard' | 'sakura' | 'terminal' | 'space' | 'custom'
export const LOOKS: Look[] = ['standard', 'sakura', 'terminal', 'space', 'custom']

/** Each theme's logo and favicon (public/themes/<theme>/, built by scripts/logos.py); custom keeps the standard one. */
const OWN_LOGO: Look[] = ['sakura', 'terminal', 'space']
export const logoFor = (l: Look) => (OWN_LOGO.includes(l) ? `/themes/${l}/logo.webp` : '/logo.png')
const faviconFor = (l: Look) => (OWN_LOGO.includes(l) ? `/themes/${l}/favicon.png` : '/favicon.png')

const KEY = 'theme'
const LOOK_KEY = 'look'
const PALETTE_KEY = 'palette'
/** The custom theme's tokens for both contrasts, for public/theme.js (which cannot compute them). */
const PALETTE_VARS_KEY = 'palette-vars'
const EFFECTS_KEY = 'effects'
const SOUNDS_KEY = 'sounds'
/** The account whose appearance the cache holds: another account signing in here does not inherit it. */
const OWNER_KEY = 'appearance-user'

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
function parseLook(raw: string | null): Look {
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
let sounds = read(SOUNDS_KEY) !== 'off'

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
  /** the theme sounds play */
  sounds: boolean
}
let snapshot: Appearance = build()
function build(): Appearance {
  return { theme: choice, resolved: resolved(), look: resolvedLook(), palette, effects, motion: motion(), sounds }
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
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon && icon.getAttribute('href') !== faviconFor(current)) icon.href = faviconFor(current)
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

/* ------------------------- the account's own appearance ------------------------- */

let saver: ((a: AccountAppearance) => void) | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
const current = (): AccountAppearance => ({ theme: choice, look, palette, effects, sounds })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A change the user made: saved to the account a moment later (colour pickers send many changes in a row). */
function persist() {
  if (!saver) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saver?.(current()), 500)
}

/** Where changes go while an account is signed in (null when signed out): the server's copy of its appearance. */
export function setAppearanceSaver(save: ((a: AccountAppearance) => void) | null) {
  saver = save
}

/**
 * The appearance of the account that signed in (`user`), as the server keeps it. An account without one yet takes
 * what this browser shows, unless the cache belongs to another account (then the standard look); either way it is
 * saved to the account. `animate` spreads it over the page like a theme change, without a sound.
 */
export function adoptAppearance(user: string, stored: unknown, animate: boolean) {
  const owner = read(OWNER_KEY)
  const own = cleanAppearance(stored)
  const next = own ?? (owner === null || owner === user ? current() : cleanAppearance({})!)
  write(OWNER_KEY, user)
  const differs =
    next.look !== look || resolvedFor(next.theme) !== resolved() || (next.look === 'custom' && JSON.stringify(next.palette) !== JSON.stringify(palette))
  const change = () => {
    choice = next.theme
    look = next.look
    palette = parsePalette(next.palette)
    effects = next.effects
    sounds = next.sounds
    writeCache()
    changed()
  }
  if (animate && differs) void Promise.race([preloadLogo(next.look), wait(400)]).then(() => reveal(change, true, REVEAL_MS[next.look]))
  else change()
  if (!own) saver?.(next)
}

/** Every setting into the cache that public/theme.js reads before the first paint. */
function writeCache() {
  write(KEY, choice === 'system' ? null : choice)
  write(LOOK_KEY, look === 'standard' ? null : look)
  write(PALETTE_KEY, JSON.stringify(palette))
  storePaletteVars()
  write(EFFECTS_KEY, effects ? null : 'off')
  write(SOUNDS_KEY, sounds ? null : 'off')
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
  const POINTS = 160
  const STEPS = 32
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
function reveal(change: () => void, differs: boolean, duration: number, from?: { x: number; y: number }) {
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
      root.animate({ clipPath: amoebaFrames(x, y) }, { duration, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }),
    )
    .catch(() => undefined)
  void transition.finished.finally(() => root.classList.remove('theme-reveal'))
}

function resolvedFor(next: ThemeChoice): 'light' | 'dark' {
  return printing() ? 'light' : next === 'system' ? (media.matches ? 'dark' : 'light') : next
}

/**
 * How long the new theme takes to cover the page: as long as the body of its sound (public/themes/<theme>/switch.mp3,
 * loud for about 1.2 to 1.4 s before its tail fades), so the two end together. A contrast change takes 1 s.
 */
const REVEAL_MS: Record<Look, number> = { standard: 1200, sakura: 1400, terminal: 1300, space: 1200, custom: 1200 }
const CONTRAST_MS = 1000

/** The contrast: light, dark or the system's. */
export function setTheme(next: ThemeChoice, from?: { x: number; y: number }) {
  reveal(
    () => {
      choice = next
      write(KEY, next === 'system' ? null : next)
      changed()
      persist()
    },
    resolvedFor(next) !== resolved(),
    CONTRAST_MS,
    from,
  )
}

/**
 * The switch sound of each theme that has one (built by scripts/sounds.py). One small audio element per theme, made
 * on first use and reused: it streams a 32 KB file instead of holding decoded audio in memory. Only a theme change
 * plays it (not a contrast change, not adopting an account's theme), and only while sounds are on.
 */
const OWN_SOUND: Look[] = ['sakura', 'terminal', 'space']
const players = new Map<Look, HTMLAudioElement>()
function player(l: Look): HTMLAudioElement | null {
  if (!OWN_SOUND.includes(l)) return null
  let audio = players.get(l)
  if (!audio) {
    audio = new Audio(`/themes/${l}/switch.mp3`)
    audio.preload = 'auto'
    audio.volume = 0.55
    players.set(l, audio)
  }
  return audio
}
/** Starts loading the theme sounds (the appearance dialog opened), so the first one plays without a delay. */
export function warmSounds() {
  if (sounds) OWN_SOUND.forEach(player)
}
/** Resolves once `l`'s sound can play through, or at once without one. */
function soundReady(l: Look): Promise<void> {
  const audio = sounds ? player(l) : null
  if (!audio || audio.readyState >= 4) return Promise.resolve()
  return new Promise((r) => {
    audio.addEventListener('canplaythrough', () => r(), { once: true })
    audio.addEventListener('error', () => r(), { once: true })
  })
}
function playSound(l: Look) {
  const audio = sounds ? player(l) : null
  if (!audio) return
  players.forEach((other) => other !== audio && !other.paused && other.pause())
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

/** A theme's logo, fetched and decoded once, so it is already painted when the amoeba reveals the new theme. */
const logos = new Map<string, Promise<void>>()
function preloadLogo(l: Look): Promise<void> {
  const src = logoFor(l)
  let ready = logos.get(src)
  if (!ready) {
    const img = new Image()
    img.src = src
    ready = img.decode().catch(() => undefined)
    logos.set(src, ready)
  }
  return ready
}

/**
 * The theme (standard, sakura, terminal, space or custom); each keeps the current contrast. Waits (at most 0.4 s)
 * for the theme's logo and sound, so the logo changes with the rest of the page under the amoeba and the sound
 * starts with it.
 */
export function setLook(next: Look, from?: { x: number; y: number }) {
  const go = () =>
    reveal(
      () => {
        look = next
        write(LOOK_KEY, next === 'standard' ? null : next)
        if (next === 'custom') storePaletteVars()
        changed()
        persist()
      },
      next !== look,
      REVEAL_MS[next],
      from,
    )
  if (next === look) return go()
  void Promise.race([Promise.all([preloadLogo(next), soundReady(next)]), wait(400)]).then(() => {
    playSound(next)
    go()
  })
}

/** The custom theme's three colours; stored with the tokens they make, for the first paint of the next visit. */
export function setPalette(next: Palette) {
  palette = parsePalette(next)
  write(PALETTE_KEY, JSON.stringify(palette))
  storePaletteVars()
  changed()
  persist()
}
const storePaletteVars = () => write(PALETTE_VARS_KEY, JSON.stringify({ light: paletteVars(palette, 'light'), dark: paletteVars(palette, 'dark') }))

export function setEffects(on: boolean) {
  effects = on
  write(EFFECTS_KEY, on ? null : 'off')
  changed()
  persist()
}

export function setSounds(on: boolean) {
  sounds = on
  write(SOUNDS_KEY, on ? null : 'off')
  if (!on) players.forEach((a) => a.pause())
  changed()
  persist()
}

media.addEventListener('change', () => choice === 'system' && changed())
reduceMotion.addEventListener('change', changed)
window.addEventListener('storage', (e) => {
  if (![KEY, LOOK_KEY, PALETTE_KEY, EFFECTS_KEY, SOUNDS_KEY].includes(e.key ?? '')) return
  choice = storedChoice()
  look = parseLook(read(LOOK_KEY))
  palette = storedPalette()
  effects = read(EFFECTS_KEY) !== 'off'
  sounds = read(SOUNDS_KEY) !== 'off'
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
