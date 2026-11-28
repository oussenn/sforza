/**
 * The appearance an account keeps on the server (settings row "appearance"), so a profile looks the same on every
 * device and two profiles in one browser each keep their own: the theme, its contrast, the custom theme's three
 * colours, motion effects and the theme sounds. src/lib/theme.ts applies it; localStorage only caches it for the
 * first paint of the next visit (public/theme.js).
 */

export const APPEARANCE_LOOKS = ['standard', 'sakura', 'terminal', 'space', 'custom'] as const
export type AppearanceLook = (typeof APPEARANCE_LOOKS)[number]
export type AppearanceContrast = 'light' | 'dark' | 'system'

export interface AccountAppearance {
  theme: AppearanceContrast
  look: AppearanceLook
  /** the custom theme's colours, as "#rrggbb" */
  palette: { base: string; primary: string; accent: string }
  effects: boolean
  sounds: boolean
}

const HEX = /^#[0-9a-f]{6}$/i

/** A stored or sent appearance with every field checked; null when it is not an object. Unknown values fall back. */
export function cleanAppearance(raw: unknown): AccountAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const a = raw as Record<string, unknown>
  const p = (a.palette && typeof a.palette === 'object' ? a.palette : {}) as Record<string, unknown>
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
  return {
    theme: a.theme === 'light' || a.theme === 'dark' ? a.theme : 'system',
    look: (APPEARANCE_LOOKS as readonly unknown[]).includes(a.look) ? (a.look as AppearanceLook) : 'standard',
    palette: { base: hex(p.base, '#e8eef7'), primary: hex(p.primary, '#2f6fde'), accent: hex(p.accent, '#f2a541') },
    effects: a.effects !== false,
    sounds: a.sounds !== false,
  }
}
