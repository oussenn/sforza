import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer'
import type { ScrapedJob } from '@shared/types'
import { AiError } from './ai'
import { baPosting, baRef } from './jobsearch'
import { fetchPublic, guardPage, isPublicUrl, readText } from './net'

/**
 * Reads a job posting from a link, cheapest source first:
 * 1. public APIs of common job boards (LinkedIn guest pages, Bundesagentur für Arbeit, Greenhouse, Lever, Workday,
 *    SmartRecruiters, Ashby),
 * 2. the page's schema.org JobPosting data (what Google for Jobs reads),
 * 3. the page text, and when the page needs JavaScript or blocks plain requests, Cloudflare's headless Chrome.
 * `clean` tells the caller whether `description` is the ad itself or a whole page that still needs cutting.
 */

export interface JobPage extends Omit<ScrapedJob, 'logo'> {
  clean: boolean
  /** the HTML that was read, for finding the company logo */
  html?: string
  /** LinkedIn: where the Apply button leads, its own Easy Apply form or the company's site */
  applyOn?: 'easy_apply' | 'company_site'
}

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,de;q=0.8,fr;q=0.7',
}

export function parseJobUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new AiError('That does not look like a link. Paste the full address of the job page (https://…).')
  }
  if (!isPublicUrl(url)) throw new AiError('Use the public web address of the job page.')
  return url
}

/* ------------------------------------------------------------------ */
/* HTML → text                                                         */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', euro: '€', copy: '©', reg: '®', trade: '™', deg: '°',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  Eacute: 'É', Egrave: 'È', agrave: 'à', acirc: 'â', aacute: 'á', ccedil: 'ç', Ccedil: 'Ç', icirc: 'î', iuml: 'ï', ocirc: 'ô',
  ugrave: 'ù', ucirc: 'û', oelig: 'œ', ntilde: 'ñ', shy: '',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m
  })
}

const BLOCK = 'p|div|section|article|header|main|aside|ul|ol|h[1-6]|tr|table|dl|dt|dd|blockquote|pre|form|fieldset|figure'

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|button|select)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, 'gi'), '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ */
/* schema.org JobPosting                                               */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>

export function findJobPosting(node: unknown, depth = 0): Json | null {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findJobPosting(n, depth + 1)
      if (found) return found
    }
    return null
  }
  const obj = node as Json
  const type = obj['@type']
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj
  return findJobPosting(obj['@graph'], depth + 1) ?? findJobPosting(Object.values(obj).filter((v) => typeof v === 'object'), depth + 1)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

function placeOf(loc: unknown): string {
  const one = (l: unknown) => {
    const address = (l as Json)?.address as Json | string | undefined
    if (typeof address === 'string') return address
    const country = address?.addressCountry
    return [address?.addressLocality, address?.addressRegion, typeof country === 'object' ? (country as Json)?.name : country]
      .map(str)
      .filter(Boolean)
      .join(', ')
  }
  return (Array.isArray(loc) ? loc.map(one) : [one(loc)]).filter(Boolean).join(' / ')
}

function fromJobPosting(jp: Json): Omit<JobPage, 'url' | 'source'> {
  const org = jp.hiringOrganization
  const parts = [str(jp.description)]
  // Some boards put the profile in separate fields instead of the description.
  for (const key of ['responsibilities', 'qualifications', 'skills', 'educationRequirements', 'experienceRequirements']) {
    const value = jp[key]
    const text = typeof value === 'string' ? value : value && typeof value === 'object' ? str((value as Json).description) : ''
    if (text && !parts.join(' ').includes(text.slice(0, 60))) parts.push(`<h3>${key}</h3>${text}`)
  }
  const remote = jp.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''
  return {
    title: decodeEntities(str(jp.title)).trim(),
    company: decodeEntities(typeof org === 'string' ? org : str((org as Json)?.name)).trim(),
    location: [placeOf(jp.jobLocation), remote].filter(Boolean).join(' · '),
    // Descriptions are HTML, sometimes entity-encoded twice.
    description: htmlToText(decodeEntities(parts.join('\n'))),
    clean: true,
  }
}

/** Parsed JSON-LD blocks of a page. */
export function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim()
    try {
      blocks.push(JSON.parse(raw))
    } catch {
      try {
        blocks.push(JSON.parse(decodeEntities(raw).replace(/[\u0000-\u001f]+/g, ' ')))
      } catch {
        /* not JSON */
      }
    }
  }
  return blocks
}

export function jobPostingFromHtml(html: string): Omit<JobPage, 'url' | 'source'> | null {
  for (const data of jsonLdBlocks(html)) {
    const jp = findJobPosting(data)
    if (jp) {
      const job = fromJobPosting(jp)
      if (job.description.length >= 200) return job
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Job boards with public APIs                                          */
/* ------------------------------------------------------------------ */

const CLOSED = 'This posting is closed or no longer exists.'

/** JSON from a job board API; a 404 there means the posting is gone. */
async function getJson(url: string): Promise<Json | null> {
  const res = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) }).catch(() => null)
  if (res?.status === 404 || res?.status === 410) throw new AiError(CLOSED)
  if (!res?.ok) return null
  return (await res.json().catch(() => null)) as Json | null
}

/** A page from a link; private addresses throw, network failures give null. */
async function getText(url: string): Promise<{ status: number; body: string; type: string; finalUrl: string } | null> {
  const res = await fetchPublic(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) }).catch((err: unknown) => {
    if (err instanceof AiError) throw err
    return null
  })
  if (!res) return null
  const type = res.headers.get('content-type') ?? ''
  const readable = /html|xml|json|text/.test(type) || !type
  const body = readable ? await readText(res, 3_000_000).catch(() => '') : ''
  if (!readable) await res.body?.cancel().catch(() => undefined)
  return { status: res.status, body, type, finalUrl: res.url || url }
}

const firstMatch = (html: string, re: RegExp) => {
  const m = html.match(re)
  return m ? htmlToText(m[1]) : ''
}

export function linkedInJobId(url: URL): string | null {
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null
  return url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? url.searchParams.get('currentJobId')?.match(/^\d{6,}$/)?.[0] ?? null
}

/** LinkedIn's guest page of a job. It throttles plain requests from servers (status 429 or 999): then open it in the browser. */
async function linkedInHtml(env: Env, id: string): Promise<string | null> {
  const guest = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`
  for (const host of ['www', 'de']) {
    const page = await getText(guest.replace('//www.', `//${host}.`))
    if (page?.status === 404 || page?.status === 410) throw new AiError(CLOSED)
    if (page?.status === 200 && page.body.includes('top-card-layout')) return page.body
  }
  const rendered = await renderWithBrowser(env, guest).catch(() => null)
  if (rendered?.html.includes('top-card-layout')) return rendered.html
  throw new AiError('LinkedIn is not letting the server read this posting right now. Open it in the browser and use the text there.')
}

async function linkedIn(url: URL, env: Env): Promise<Omit<JobPage, 'url'> | null> {
  const id = linkedInJobId(url)
  if (!id) return null
  const html = await linkedInHtml(env, id)
  if (!html) return null
  const markup = html.match(/<div[^>]*show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>\s*(?:<button|<\/section|<div)/)?.[1]
  const description = htmlToText(markup ?? html)
  const criteria = [...html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => `${htmlToText(m[1])}: ${htmlToText(m[2])}`)
    .join('\n')
  return {
    title: firstMatch(html, /<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/),
    company: firstMatch(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/) || firstMatch(html, /topcard__flavor[^>]*>([\s\S]*?)<\/span>/),
    location: firstMatch(html, /topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/),
    description: [description, criteria].filter(Boolean).join('\n\n'),
    clean: !!markup,
    source: 'LinkedIn',
    applyOn: html.includes('public_jobs_apply-link-onsite') ? 'easy_apply' : html.includes('public_jobs_apply-link-offsite') ? 'company_site' : undefined,
  }
}

async function greenhouse(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const m = url.hostname.match(/^(?:job-)?boards(\.eu)?\.greenhouse\.io$/) && url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/)
  if (!m) return null
  const eu = url.hostname.includes('.eu.')
  const data = await getJson(`https://boards-api${eu ? '.eu' : ''}.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`)
  if (!data?.content) return null
  return {
    title: str(data.title),
    company: str(data.company_name) || m[1],
    location: str((data.location as Json)?.name),
    description: htmlToText(decodeEntities(str(data.content))),
    clean: true,
    source: 'Greenhouse',
  }
}

async function lever(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const m = url.hostname.match(/^jobs(\.eu)?\.lever\.co$/) && url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/)
  if (!m) return null
  const eu = url.hostname.includes('.eu.')
  // The API has no company name (only the URL slug); the posting page's schema.org data has it, and its logo.
  const [data, page] = await Promise.all([
    getJson(`https://api${eu ? '.eu' : ''}.lever.co/v0/postings/${m[1]}/${m[2]}`),
    getText(url.toString()).catch(() => null),
  ])
  if (!data?.text) return null
  const lists = ((data.lists as Json[] | undefined) ?? []).map((l) => `<h3>${str(l.text)}</h3><ul>${str(l.content)}</ul>`).join('')
  const categories = data.categories as Json | undefined
  const html = page?.status === 200 ? page.body : undefined
  const org = html ? jsonLdBlocks(html).map((b) => findJobPosting(b)?.hiringOrganization).find(Boolean) : undefined
  const company = typeof org === 'string' ? org : str((org as Json | undefined)?.name)
  return {
    title: str(data.text),
    company: decodeEntities(company).trim() || m[1],
    html,
    location: str(categories?.location),
    description: htmlToText(`${str(data.description)}${lists}${str(data.additional)}`),
    clean: true,
    source: 'Lever',
  }
}

async function workday(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const host = url.hostname.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (!host) return null
  const segments = url.pathname.split('/').filter(Boolean)
  const jobAt = segments.indexOf('job')
  if (jobAt < 1) return null
  const site = segments[jobAt - 1]
  const data = await getJson(`https://${url.hostname}/wday/cxs/${host[1]}/${site}/${segments.slice(jobAt).join('/')}`)
  const info = data?.jobPostingInfo as Json | undefined
  if (!info?.jobDescription) return null
  return {
    title: str(info.title),
    company: str((data?.hiringOrganization as Json)?.name) || host[1],
    location: str(info.location),
    description: htmlToText(str(info.jobDescription)),
    clean: true,
    source: 'Workday',
  }
}

async function smartRecruiters(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const m = /^(jobs|careers)\.smartrecruiters\.com$/.test(url.hostname) && url.pathname.match(/^\/([^/]+)\/(\d{6,})/)
  if (!m) return null
  const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`)
  const sections = (data?.jobAd as Json | undefined)?.sections as Record<string, Json> | undefined
  if (!sections) return null
  const location = data?.location as Json | undefined
  return {
    title: str(data?.name),
    company: str((data?.company as Json)?.name) || m[1],
    location: [location?.city, location?.country].map(str).filter(Boolean).join(', ') + (location?.remote ? ' · Remote' : ''),
    description: htmlToText(
      ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
        .map((k) => (sections[k]?.text ? `<h3>${str(sections[k].title)}</h3>${str(sections[k].text)}` : ''))
        .join(''),
    ),
    clean: true,
    source: 'SmartRecruiters',
  }
}

async function ashby(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const m = url.hostname === 'jobs.ashbyhq.com' && url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/)
  if (!m) return null
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}`)
  const job = ((data?.jobs as Json[] | undefined) ?? []).find((j) => j.id === m[2])
  if (!job) return null
  return {
    title: str(job.title),
    company: m[1],
    location: str(job.location),
    description: job.descriptionHtml ? htmlToText(str(job.descriptionHtml)) : str(job.descriptionPlain),
    clean: true,
    source: 'Ashby',
  }
}

async function arbeitsagentur(url: URL): Promise<Omit<JobPage, 'url'> | null> {
  const ref = baRef(url)
  const job = ref ? await baPosting(ref) : null
  if (!job) return null
  return { title: job.title, company: job.company, location: job.location, description: job.description, clean: true, source: 'Bundesagentur für Arbeit' }
}

/* ------------------------------------------------------------------ */
/* Generic pages                                                        */
/* ------------------------------------------------------------------ */

const BLOCKED = /just a moment|attention required|verify you are human|are you a robot|captcha|access denied|checking your browser|enable javascript|request blocked|unusual traffic|cf-chl|px-captcha/i

function looksBlocked(status: number, text: string): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500 || (text.length < 2500 && BLOCKED.test(text))
}

async function renderWithBrowser(env: Env, url: string): Promise<{ html: string; text: string }> {
  const browser = await puppeteer.launch(env.BROWSER as unknown as BrowserWorker)
  try {
    const page = await browser.newPage()
    await guardPage(page)
    await page.setUserAgent(USER_AGENT)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => undefined)
    // Single-page apps fill the ad in after load.
    await page.waitForFunction('document.body && document.body.innerText.length > 1500', { timeout: 8_000 }).catch(() => undefined)
    if (!isPublicUrl(page.url())) throw new AiError('That page did not open on a public address.')
    const html = await page.content()
    const text = (await page.evaluate('document.body ? document.body.innerText : ""')) as string
    return { html, text }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export async function readJobPage(env: Env, raw: string, progress: (message: string) => Promise<void>): Promise<JobPage> {
  const url = parseJobUrl(raw)
  for (const board of [linkedIn, arbeitsagentur, greenhouse, lever, workday, smartRecruiters, ashby]) {
    const job = await board(url, env).catch((err: unknown) => {
      if (err instanceof AiError) throw err
      return null
    })
    if (job && job.description.length >= 200) return { ...job, url: url.toString() }
  }

  const page = await getText(url.toString())
  // Closed postings answer 404/410 or bounce back to the company's job list.
  if (page && (page.status === 404 || page.status === 410 || /[?&]error=true/.test(page.finalUrl))) throw new AiError(CLOSED)
  if (page && page.body && !page.type.includes('json')) {
    const posting = jobPostingFromHtml(page.body)
    if (posting) return { ...posting, url: url.toString(), source: 'schema.org', html: page.body }
    const text = htmlToText(page.body)
    if (!looksBlocked(page.status, text) && text.length >= 800) {
      return {
        title: firstMatch(page.body, /<title[^>]*>([\s\S]*?)<\/title>/),
        company: '',
        location: '',
        description: text,
        clean: false,
        url: url.toString(),
        source: 'page',
        html: page.body,
      }
    }
  } else if (page && !page.body && page.status === 200 && page.type) {
    throw new AiError('That link is a file, not a web page. Open the job ad and paste its text instead.')
  }

  await progress('The page needs a browser, opening it…')
  let rendered: { html: string; text: string }
  try {
    rendered = await renderWithBrowser(env, url.toString())
  } catch (err) {
    console.warn('Browser rendering failed', err)
    throw new AiError('Could not open that page right now. Paste the job description instead.')
  }
  const posting = jobPostingFromHtml(rendered.html)
  if (posting) return { ...posting, url: url.toString(), source: 'schema.org (browser)', html: rendered.html }
  const text = rendered.text.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (looksBlocked(200, text) || text.length < 400) {
    throw new AiError('This site blocks automated reading (login wall or bot check). Paste the job description instead.')
  }
  return {
    title: firstMatch(rendered.html, /<title[^>]*>([\s\S]*?)<\/title>/),
    company: '',
    location: '',
    description: text,
    clean: false,
    url: url.toString(),
    source: 'browser',
    html: rendered.html,
  }
}
