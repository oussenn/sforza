/**
 * The custom theme: three colours the user picks (page, primary, accent) turned into the app's colour tokens, for
 * the light and the dark contrast alike. Pure functions: theme.ts applies the result to <html>, public/theme.js
 * replays the stored result before the first paint.
 */

export interface Palette {
  /** the page and its surfaces take this colour's hue */
  base: string
  /** buttons, links, focus rings */
  primary: string
  /** highlights and hovered rows */
  accent: string
}

export const DEFAULT_PALETTE: Palette = { base: '#e8eef7', primary: '#2f6fde', accent: '#f2a541' }

export type Contrast = 'light' | 'dark'

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim())
}

/** "#abc", "abc" or "#aabbcc" as "#aabbcc"; null when it is not a colour. */
export function normalHex(value: string): string | null {
  const m = HEX.exec(value.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

/** A stored palette, or the default for whatever part is missing or not a colour. */
export function parsePalette(raw: unknown): Palette {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: keyof Palette) => (isHex(p[k]) ? normalHex(p[k] as string)! : DEFAULT_PALETTE[k])
  return { base: pick('base'), primary: pick('primary'), accent: pick('accent') }
}

/** sRGB hex to OKLCH: lightness 0–1, chroma, hue in degrees (Björn Ottosson's OKLab). */
export function hexToOklch(hex: string): [number, number, number] {
  const h = normalHex(hex) ?? '#000000'
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const [r, g, b] = lin
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return [L, C, H]
}

const r3 = (v: number) => Math.round(v * 1000) / 1000
const css = (L: number, C: number, H: number, alpha?: number) =>
  `oklch(${r3(L)} ${r3(C)} ${Math.round(H)}${alpha === undefined ? '' : ` / ${Math.round(alpha * 100)}%`})`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The colour tokens of the custom theme in one contrast, as CSS custom properties for <html>. */
export function paletteVars(p: Palette, mode: Contrast): Record<string, string> {
  const [, bc, bh] = hexToOklch(p.base)
  const [pl, pc, ph] = hexToOklch(p.primary)
  const [, ac, ah] = hexToOklch(p.accent)
  const tint = (c: number, max: number) => Math.min(c, max)
  const dark = mode === 'dark'
  // The primary colour keeps its hue and chroma; its lightness moves just enough for its text to stay readable.
  const primaryL = dark ? clamp(pl, 0.7, 0.84) : clamp(pl, 0.42, 0.62)
  const onPrimary = primaryL > 0.66 ? css(0.2, tint(pc, 0.05), ph) : css(0.985, 0, 0)
  const vars: Record<string, string> = dark
    ? {
        '--background': css(0.165, tint(bc, 0.03), bh),
        '--foreground': css(0.96, tint(bc, 0.015), bh),
        '--card': css(0.21, tint(bc, 0.032), bh),
        '--popover': css(0.22, tint(bc, 0.032), bh),
        '--muted': css(0.27, tint(bc, 0.03), bh),
        '--muted-foreground': css(0.73, tint(bc, 0.03), bh),
        '--secondary': css(0.28, tint(bc, 0.035), bh),
        '--accent': css(0.31, tint(ac, 0.07), ah),
        '--accent-foreground': css(0.96, tint(ac, 0.03), ah),
        '--border': 'oklch(1 0 0 / 11%)',
        '--input': 'oklch(1 0 0 / 16%)',
        '--ring': css(0.62, pc * 0.85, ph),
        '--hairline': 'oklch(1 0 0 / 8%)',
        '--editor-bg': css(0.15, tint(bc, 0.03), bh),
        '--preview-canvas': css(0.19, tint(bc, 0.03), bh),
        '--scene-1': css(0.22, tint(bc, 0.07), bh),
        '--scene-2': css(0.27, tint(ac, 0.09), ah),
        '--scene-3': css(0.25, tint(pc, 0.09), ph),
      }
    : {
        '--background': css(0.975, tint(bc, 0.025), bh),
        '--foreground': css(0.22, tint(pc, 0.04), ph),
        '--card': css(0.995, tint(bc, 0.01), bh),
        '--popover': css(0.995, tint(bc, 0.01), bh),
        '--muted': css(0.945, tint(bc, 0.03), bh),
        '--muted-foreground': css(0.5, tint(bc, 0.035), bh),
        '--secondary': css(0.94, tint(bc, 0.035), bh),
        '--accent': css(0.93, tint(ac, 0.07), ah),
        '--accent-foreground': css(0.27, tint(ac, 0.06), ah),
        '--border': css(0.9, tint(bc, 0.03), bh),
        '--input': css(0.88, tint(bc, 0.03), bh),
        '--ring': css(0.66, pc * 0.85, ph),
        '--hairline': css(0.25, tint(bc, 0.03), bh, 0.08),
        '--editor-bg': css(0.955, tint(bc, 0.04), bh),
        '--preview-canvas': css(0.93, tint(bc, 0.035), bh),
        '--scene-1': css(0.93, tint(bc, 0.07), bh),
        '--scene-2': css(0.9, tint(ac, 0.09), ah),
        '--scene-3': css(0.88, tint(pc, 0.09), ph),
      }
  vars['--primary'] = css(primaryL, pc, ph)
  vars['--primary-foreground'] = onPrimary
  vars['--card-foreground'] = vars['--foreground']
  vars['--popover-foreground'] = vars['--foreground']
  vars['--secondary-foreground'] = vars['--foreground']
  vars['--sidebar'] = vars['--card']
  vars['--sidebar-foreground'] = vars['--foreground']
  vars['--sidebar-primary'] = vars['--primary']
  vars['--sidebar-primary-foreground'] = onPrimary
  vars['--sidebar-accent'] = vars['--accent']
  vars['--sidebar-accent-foreground'] = vars['--accent-foreground']
  vars['--sidebar-border'] = vars['--border']
  vars['--sidebar-ring'] = vars['--ring']
  return vars
}

/** Every custom property paletteVars sets, so switching away from the custom theme can remove them all. */
export const PALETTE_KEYS = Object.keys(paletteVars(DEFAULT_PALETTE, 'light'))
