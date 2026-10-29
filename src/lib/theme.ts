import { useSyncExternalStore } from 'react'

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

export function setTheme(next: ThemeChoice) {
  choice = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  changed()
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
