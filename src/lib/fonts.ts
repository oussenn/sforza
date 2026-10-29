import { FONT_FACES, type FontFaceSpec } from './font-loaders'

const pending = new Map<string, Promise<unknown>>()

/**
 * Glyph fallback for "→" (none of the CV fonts has it). Self-hosted slice of static Noto Sans SC, the font
 * the original FlowCV PDF used for arrows, so arrows keep the same width and line breaks stay identical.
 */
const SYMBOL_FACES: FontFaceSpec[] = [
  { weight: '400', style: 'normal', url: '/fonts/noto-sans-sc-arrows-400.woff2', range: 'U+2192' },
  { weight: '700', style: 'normal', url: '/fonts/noto-sans-sc-arrows-700.woff2', range: 'U+2192' },
]

// Latin, Latin Extended, punctuation, € and ™; arrows fall back to Noto Sans SC like every other CV font.
const CMU_RANGE = 'U+0000-024F,U+02B0-02FF,U+1E00-1EFF,U+2000-206F,U+20AC,U+2122,U+2212'

/** Fonts self-hosted from public/fonts rather than @fontsource: CMU Serif (Computer Modern, OFL, from the computer-modern package). */
const LOCAL_FACES: Record<string, FontFaceSpec[]> = {
  'CMU Serif': [
    { weight: '400', style: 'normal', url: '/fonts/cmu-serif-400-normal.woff2', range: CMU_RANGE },
    { weight: '400', style: 'italic', url: '/fonts/cmu-serif-400-italic.woff2', range: CMU_RANGE },
    { weight: '700', style: 'normal', url: '/fonts/cmu-serif-700-normal.woff2', range: CMU_RANGE },
    { weight: '700', style: 'italic', url: '/fonts/cmu-serif-700-italic.woff2', range: CMU_RANGE },
  ],
}

function register(family: string, specs: FontFaceSpec[]): Promise<unknown> {
  const existing = pending.get(family)
  if (existing) return existing
  const loads = specs.map((spec) => {
    const face = new FontFace(family, `url(${spec.url}) format('woff2')`, {
      weight: spec.weight,
      style: spec.style,
      unicodeRange: spec.range,
      display: 'swap',
    })
    document.fonts.add(face)
    return face.load().catch(() => undefined)
  })
  const all = Promise.all(loads)
  pending.set(family, all)
  return all
}

/**
 * Registers a CV font. Fonts are self-hosted static files (@fontsource) rather than Google's variable
 * fonts, because Chrome only embeds static fonts as real fonts in PDFs (variable fonts become Type3
 * glyph outlines that some ATS parsers read poorly). Faces are registered through the FontFace API
 * with explicit unicode ranges and loaded eagerly, so printing never waits on a lazy fallback.
 */
export function ensureFont(family: string | undefined): Promise<unknown> {
  if (typeof document === 'undefined') return Promise.resolve()
  const symbols = register('Noto Sans SC', SYMBOL_FACES)
  if (!family) return symbols
  return Promise.all([symbols, register(family, FONT_FACES[family] ?? LOCAL_FACES[family] ?? [])])
}

/** Resolves once every weight/style of a family (plus the symbol fallback) is loaded. */
export async function loadFont(family: string): Promise<void> {
  await ensureFont(family)
  await document.fonts.ready
}
