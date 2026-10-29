import puppeteer, { type BrowserWorker, type Page } from '@cloudflare/puppeteer'
import type { Application, Lang, Resume, ResumeStyle } from '@shared/types'
import { letterFileName, pdfFileName } from '@shared/utils'
import { signPrintToken } from './auth'
import { ownerOf, type Store } from './db'

export class PdfError extends Error {}

/**
 * Renders the CV with Cloudflare's headless Chrome: loads the app's /print page (same templates and
 * pagination as the preview) and prints it. The PDF keeps real text, embedded fonts and clickable links.
 * Results are cached per CV version and language, so repeated downloads cost no browser time.
 */
export async function renderPdf(env: Env & Store, origin: string, resume: Resume, lang: Lang): Promise<Response> {
  return printToPdf(env, cvPrintUrl(env, origin, resume, lang), cvCacheUrl(env, origin, resume, lang), pdfFileName(resume, lang))
}

// The print page loads the CV with a short-lived token signed for this account.
const cvPrintUrl = (env: Env & Store, origin: string, resume: Resume, lang: Lang) => async () =>
  `${origin}/print?id=${encodeURIComponent(resume.id)}&lang=${lang}&token=${encodeURIComponent(await signPrintToken(env, ownerOf(env), resume.id))}`

const cvCacheUrl = (env: Env, origin: string, resume: Resume, lang: Lang, kind = 'pdf') =>
  `${origin}/__${kind}-cache/${env.CF_VERSION_METADATA?.id ?? 'dev'}/${resume.id}/${lang}/${encodeURIComponent(resume.updatedAt)}`

/** What the print page measured (src/resume/layout.ts). */
export interface LayoutReport {
  pages: number
  lastPageFill: number
  split: string[]
  gaps: { page: number; column: string; mm: number; before: string }[]
  lonely?: { page: number; sections: string[]; types: string[] }[]
}

/** What the print page measured on a letter (src/resume/layout.ts). */
export interface LetterFit {
  pages: number
  overMm: number
}

/** The style that fills one page best, found on the print page (src/resume/fit.ts). */
export interface FitReport {
  style: ResumeStyle
  layout: LayoutReport
  status: 'fits' | 'too_long' | 'too_short'
  tries: number
}

/**
 * How the CV sits on its pages, measured on the same print page the PDF comes from. The PDF of that run is
 * cached too, so a download right after costs no browser time. Cached per CV version.
 */
export function checkLayout(env: Env & Store, origin: string, resume: Resume, lang: Lang): Promise<LayoutReport> {
  return measure<LayoutReport>(env, cvPrintUrl(env, origin, resume, lang), cvCacheUrl(env, origin, resume, lang), cvCacheUrl(env, origin, resume, lang, 'layout'))
}

/** How many pages the letter prints on, measured like the CV; its PDF is cached for the download too. */
export function checkLetterFit(env: Env & Store, origin: string, application: Application, cv: Resume, lang: Lang): Promise<LetterFit> {
  const print = letterPrint(env, origin, application, cv, lang)
  return measure<LetterFit>(env, print.url, print.cacheUrl, print.cacheUrl.replace('/__pdf-cache/', '/__layout-cache/'))
}

async function measure<T>(env: Env, url: () => Promise<string>, pdfCacheUrl: string, layoutCacheUrl: string): Promise<T> {
  const cache = (caches as unknown as { default: Cache }).default
  const layoutKey = new Request(layoutCacheUrl)
  const hit = await cache.match(layoutKey)
  if (hit) return (await hit.json()) as T

  const { layout, pdf } = await onPrintPage(env, url, async (page) => {
    const layout = (await page.evaluate('window.__LAYOUT || null')) as T
    if (!layout) throw new PdfError('The print page did not report its layout.')
    return { layout, pdf: await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }) }
  })
  const keep = { 'Cache-Control': 'max-age=2592000' }
  await cache.put(layoutKey, new Response(JSON.stringify(layout), { headers: { 'Content-Type': 'application/json', ...keep } }))
  await cache.put(new Request(pdfCacheUrl), new Response(pdf.slice(), { headers: { 'Content-Type': 'application/pdf', ...keep } }))
  return layout
}

/** The motivation letter of an application, styled like the CV it goes with. */
export async function renderLetterPdf(env: Env & Store, origin: string, application: Application, cv: Resume, lang: Lang): Promise<Response> {
  const print = letterPrint(env, origin, application, cv, lang)
  return printToPdf(env, print.url, print.cacheUrl, print.fileName)
}

function letterPrint(env: Env & Store, origin: string, application: Application, cv: Resume, lang: Lang) {
  const letter = application.letters?.[lang]
  if (!letter) throw new PdfError('This application has no letter in that language.')
  const build = env.CF_VERSION_METADATA?.id ?? 'dev'
  const url = async () =>
    `${origin}/print?letter=${encodeURIComponent(application.id)}&lang=${lang}&token=${encodeURIComponent(await signPrintToken(env, ownerOf(env), `letter:${application.id}`))}`
  // The card's letter style is part of the version: a new font or colour is a new PDF.
  const version = encodeURIComponent(`${letter.updatedAt}|${cv.updatedAt}|${JSON.stringify(application.letterStyle ?? {})}`)
  const name = cv.content[lang]?.personal.name ?? cv.content[cv.sourceLang]?.personal.name ?? ''
  return { url, cacheUrl: `${origin}/__pdf-cache/${build}/letter/${application.id}/${lang}/${version}`, fileName: letterFileName(name, lang) }
}

async function printToPdf(env: Env, url: () => Promise<string>, cacheUrl: string, fileName: string): Promise<Response> {
  const cacheKey = new Request(cacheUrl)
  const cache = (caches as unknown as { default: Cache }).default
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  }

  const cached = await cache.match(cacheKey)
  if (cached) return new Response(cached.body, { headers })

  const pdf = await onPrintPage(env, url, (page) => page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }))

  await cache.put(cacheKey, new Response(pdf.slice(), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'max-age=2592000' } }))
  return new Response(pdf, { headers })
}

/**
 * Finds the font size, spacing and column width that fill one page best for one language of the CV, by trying
 * them on the print page itself. Nothing is saved or cached: the CV keeps its style until the caller saves one.
 */
export function fitLayout(env: Env & Store, origin: string, resume: Resume, lang: Lang): Promise<FitReport> {
  return onPrintPage(
    env,
    async () => `${await cvPrintUrl(env, origin, resume, lang)()}&fit=1`,
    async (page) => {
      const fit = (await page.evaluate('window.__FIT || null')) as FitReport | null
      if (!fit) throw new PdfError('The print page did not report a fit.')
      return fit
    },
    45_000,
  )
}

/** Opens the print page in headless Chrome, waits until it reports ready (fonts, photo, pagination) and hands it to `use`. */
async function onPrintPage<T>(env: Env, url: () => Promise<string>, use: (page: Page) => Promise<T>, timeout = 25_000): Promise<T> {
  const browser = await puppeteer.launch(env.BROWSER as unknown as BrowserWorker)
  try {
    const page = await browser.newPage()
    await page.goto(await url(), { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await page.waitForFunction('window.__PDF_READY === true', { timeout })
    const error = await page.evaluate('window.__PDF_ERROR || null')
    if (error) throw new PdfError(String(error))
    return await use(page)
  } finally {
    await browser.close()
  }
}
