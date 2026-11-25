import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, hexToOklch, normalHex, PALETTE_KEYS, paletteVars, parsePalette } from '../src/lib/palette'

const L = (css: string) => Number(/oklch\(([\d.]+)/.exec(css)![1])

describe('custom theme palette', () => {
  it('reads hex colours and falls back per colour', () => {
    expect(normalHex('#ABC')).toBe('#aabbcc')
    expect(normalHex('12ab9f')).toBe('#12ab9f')
    expect(normalHex('red')).toBeNull()
    expect(parsePalette({ base: '#fff', primary: 'nope' })).toEqual({ base: '#ffffff', primary: DEFAULT_PALETTE.primary, accent: DEFAULT_PALETTE.accent })
    expect(parsePalette(null)).toEqual(DEFAULT_PALETTE)
  })

  it('converts sRGB to OKLCH', () => {
    const [l0] = hexToOklch('#000000')
    const [l1, c1] = hexToOklch('#ffffff')
    expect(l0).toBeCloseTo(0, 3)
    expect(l1).toBeCloseTo(1, 3)
    expect(c1).toBeLessThan(0.001)
    const [lr, cr, hr] = hexToOklch('#ff0000')
    expect(lr).toBeCloseTo(0.628, 2)
    expect(cr).toBeCloseTo(0.258, 2)
    expect(hr).toBeCloseTo(29.2, 0)
  })

  it('makes a light and a dark contrast from three colours', () => {
    const light = paletteVars({ base: '#e8eef7', primary: '#2f6fde', accent: '#f2a541' }, 'light')
    const dark = paletteVars({ base: '#e8eef7', primary: '#2f6fde', accent: '#f2a541' }, 'dark')
    expect(L(light['--background'])).toBeGreaterThan(0.95)
    expect(L(light['--foreground'])).toBeLessThan(0.3)
    expect(L(dark['--background'])).toBeLessThan(0.2)
    expect(L(dark['--foreground'])).toBeGreaterThan(0.9)
    // The primary keeps its hue, its lightness moves into the readable band of each contrast.
    expect(light['--primary']).toMatch(/ 26\d\)$/)
    expect(L(dark['--primary'])).toBeGreaterThanOrEqual(0.7)
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    expect(PALETTE_KEYS).toContain('--sidebar-ring')
  })

  it('keeps text on the primary readable for a pale and a deep primary', () => {
    const pale = paletteVars({ base: '#ffffff', primary: '#ffe066', accent: '#ffffff' }, 'dark')
    const deep = paletteVars({ base: '#ffffff', primary: '#1a237e', accent: '#ffffff' }, 'light')
    expect(L(pale['--primary-foreground'])).toBeLessThan(0.3)
    expect(L(deep['--primary-foreground'])).toBeGreaterThan(0.9)
  })
})
