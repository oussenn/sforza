import { fetchPublic, readText } from './net'
import { USER_AGENT } from './scrape'

/**
 * Job boards besides the Bundesagentur (jobsearch.ts), read the way a signed-out visitor sees them: LinkedIn's guest
 * job search, StepStone's result pages and Arbeitnow's public API. Each search returns listings (title, company, place,
 * date, link); the full text comes from read_job_posting. Boards throttle servers now and then: a failed board is
 * reported, never guessed, and the others still answer.
 */

export interface Listing {
  source: 'Arbeitsagentur' | 'LinkedIn' | 'StepStone' | 'Arbeitnow' | 'Stellenwerk'
  /** the board's own id */
  id: string
  title: string
  company: string
  location: string
  /** the date the board shows, YYYY-MM-DD ('' when unknown) */
  posted_on: string
  url: string
  /** the company's own posting, when the board links it */
  external_url?: string
  /** the board says the ad is in English (StepStone's language filter) */
  english?: boolean
  remote?: boolean
  distance_km?: number | null
  hours?: string
  /** a short text the board gives with the listing (Arbeitnow sends the whole ad) */
  text?: string
}

const HEADERS = { 'User-Agent': USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }

class BoardError extends Error {}

async function get(url: string, max = 4_000_000): Promise<string> {
  const res = await fetchPublic(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) throw new BoardError('no answer')
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new BoardError(`status ${res.status}${res.status === 429 || res.status === 999 ? ' (throttled; try again later or use the browser)' : ''}`)
  }
  return readText(res, max)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim()

/* ------------------------------------------------------------------ */
/* LinkedIn                                                             */
/* ------------------------------------------------------------------ */

/** Cards of one page of LinkedIn's guest job search. */
export function parseLinkedInCards(html: string): Listing[] {
  const out: Listing[] = []
  for (const card of html.split('<li>').slice(1)) {
    const id = card.match(/jobPosting:(\d+)/)?.[1] ?? card.match(/\/view\/[^"]*?-(\d+)\?/)?.[1]
    if (!id) continue
    const pick = (re: RegExp) => text(card.match(re)?.[1] ?? '')
    out.push({
      source: 'LinkedIn',
      id,
      title: pick(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/),
      company: pick(/base-search-card__subtitle[^>]*>[\s\S]*?>([\s\S]*?)<\/a>/) || pick(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/),
      location: pick(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/),
      posted_on: card.match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? '',
      url: `https://www.linkedin.com/jobs/view/${id}`,
    })
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One search of LinkedIn's guest search: `pages` pages of 25, posted within `days`; remote = LinkedIn's remote filter across the country. */
export interface LinkedInSearch {
  keywords: string
  location: string
  remote?: boolean
  pages?: number
}

/**
 * LinkedIn's guest search, one request after the other with a pause: it throttles bursts from servers (status 429).
 * A throttled request is tried once more on de.linkedin.com; when that is throttled too, the rest is skipped and
 * reported instead of hammering it.
 */
export async function searchLinkedIn(searches: LinkedInSearch[], days: number): Promise<{ listings: Listing[]; errors: string[] }> {
  const out = new Map<string, Listing>()
  const errors: string[] = []
  let first = true
  outer: for (const s of searches) {
    for (let page = 0; page < (s.pages ?? 2); page++) {
      const params = new URLSearchParams({ keywords: s.keywords, location: s.location, f_TPR: `r${Math.max(1, days) * 86_400}`, start: String(page * 25) })
      if (s.remote) params.set('f_WT', '2')
      if (!first) await sleep(700)
      first = false
      let html: string | null = null
      for (const host of ['www', 'de']) {
        try {
          html = await get(`https://${host}.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`)
          break
        } catch (err) {
          if (host === 'de' || !/429|999/.test((err as Error).message)) {
            errors.push(`"${s.keywords}"${s.remote ? ' (remote)' : ''}: ${(err as Error).message}`)
            if (/429|999/.test((err as Error).message)) {
              errors.push('LinkedIn throttled the server: the remaining LinkedIn searches were skipped. Search LinkedIn in the browser, or try again in a few minutes.')
              break outer
            }
          }
          await sleep(1500)
        }
      }
      if (html === null) break
      const cards = parseLinkedInCards(html)
      for (const c of cards) if (!out.has(c.id)) out.set(c.id, { ...c, ...(s.remote && { remote: true }) })
      if (cards.length < 25) break
    }
  }
  return { listings: [...out.values()], errors }
}

/** New LinkedIn job ids grow by about this many a day (measured over November 2026 runs). */
const LINKEDIN_IDS_PER_DAY = 350_000

/**
 * How many days older than the newest listing of the same search a LinkedIn ad probably is, from its id: LinkedIn
 * shows a reposted or refreshed old ad with a new date, but its id stays the old one. Null for other boards.
 */
export function linkedInAgeDays(listing: Listing, all: Listing[]): number | null {
  if (listing.source !== 'LinkedIn') return null
  const ids = all.filter((l) => l.source === 'LinkedIn' && /^\d+$/.test(l.id)).map((l) => Number(l.id))
  if (ids.length < 5) return null
  const newest = Math.max(...ids)
  return Math.max(0, Math.round((newest - Number(listing.id)) / LINKEDIN_IDS_PER_DAY))
}

/* ------------------------------------------------------------------ */
/* StepStone                                                            */
/* ------------------------------------------------------------------ */

/** "Werkstudent Data" → "werkstudent-data", "Düsseldorf" → "duesseldorf", as StepStone's addresses spell them. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** The JSON array that starts at `at` (a "["), read up to its closing bracket. */
function arrayAt(s: string, at: number): unknown[] {
  let depth = 0
  let inString = false
  for (let i = at; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(s.slice(at, i + 1)) as unknown[]
    }
  }
  return []
}

/** The listings embedded in a StepStone result page. */
export function parseStepStone(html: string, english: boolean): Listing[] {
  const at = html.indexOf('"items":[{"harmonisedId"')
  if (at < 0) return []
  const items = arrayAt(html, at + 8) as Record<string, unknown>[]
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  return items.map((a) => {
    const url = s(a.url).split('?')[0]
    const full = url.startsWith('http') ? url : `https://www.stepstone.de${url}`
    return {
      source: 'StepStone',
      id: url.match(/-(\d+)-inline/)?.[1] ?? String(a.id ?? url),
      title: s(a.title),
      company: s(a.companyName),
      location: s(a.location),
      posted_on: s(a.datePosted).slice(0, 10),
      url: full,
      ...(english && { english: true }),
    }
  })
}

/** StepStone's search around a city (radius in km), posted within a day or a week; englishOnly uses its ad-language filter. */
export async function searchStepStone(keywords: string, city: string, radiusKm: number, days: number, englishOnly = false): Promise<Listing[]> {
  const params = new URLSearchParams({ radius: String(Math.min(100, Math.max(5, radiusKm || 30))), ag: days <= 1 ? 'age_1' : 'age_7' })
  if (englishOnly) {
    params.set('action', 'facet_selected;detectedLanguages;en')
    params.set('fdl', 'en')
  }
  const where = city ? `/in-${slug(city)}` : ''
  return parseStepStone(await get(`https://www.stepstone.de/jobs/${slug(keywords)}${where}?${params}`), englishOnly)
}

/* ------------------------------------------------------------------ */
/* Arbeitnow                                                            */
/* ------------------------------------------------------------------ */

/** Arbeitnow's public API (newest first): every listing of the last `days`, whole ads included; the caller filters by words and place. */
export async function searchArbeitnow(days: number, maxPages = 5): Promise<Listing[]> {
  const since = Date.now() / 1000 - Math.max(1, days) * 86_400
  const out: Listing[] = []
  for (let page = 1; page <= maxPages; page++) {
    const data = JSON.parse(await get(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, 30_000_000)) as { data?: Record<string, unknown>[] }
    const rows = data.data ?? []
    let old = 0
    for (const j of rows) {
      const created = typeof j.created_at === 'number' ? j.created_at : 0
      if (created < since) {
        old++
        continue
      }
      const s = (v: unknown) => (typeof v === 'string' ? v : '')
      out.push({
        source: 'Arbeitnow',
        id: s(j.slug),
        title: s(j.title),
        company: s(j.company_name),
        location: s(j.location),
        posted_on: new Date(created * 1000).toISOString().slice(0, 10),
        url: s(j.url),
        remote: j.remote === true,
        text: text(s(j.description)).slice(0, 8000),
      })
    }
    if (!rows.length || old === rows.length) break
  }
  return out
}

/** Whether a listing's title or text uses the search words: each keyword phrase counts when all its words are there. */
export function matchesKeywords(l: Listing, keywords: string[]): boolean {
  const hay = `${l.title} ${l.text ?? ''}`.toLowerCase()
  return keywords.some((k) =>
    k
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(w)),
  )
}

/* ------------------------------------------------------------------ */
/* Stellenwerk (student jobs of the universities in the Ruhr area)      */
/* ------------------------------------------------------------------ */

/** The Stellenwerk regions the search reads, by their address. */
export const STELLENWERK_CITIES = ['dortmund', 'bochum']

/** The cards of a Stellenwerk region page: title, company, place, job type and work mode; the date is in the link (yymmdd). */
export function parseStellenwerk(html: string, city: string): Listing[] {
  const out: Listing[] = []
  for (const m of html.matchAll(new RegExp(`href="(/${city}/[a-z0-9-]+-(\\d{6})-(\\d+))"[^>]*>([\\s\\S]*?)</a>`, 'g'))) {
    const card = m[4].replace(/<svg[\s\S]*?<\/svg>/g, '')
    // <p>title</p> <p>company <span>·</span> place</p> … <span>job type</span><span>work mode</span>; private ads have no company line.
    const paragraphs = [...card.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => p[1])
    const title = text(paragraphs[0] ?? '')
    const line = paragraphs[1] ?? ''
    const [company = '', location = ''] = /<span[^>]*>\s*·\s*<\/span>/.test(line) ? line.split(/<span[^>]*>\s*·\s*<\/span>/).map((x) => text(x)) : ['', '']
    const tags = [...card.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((s) => text(s[1])).filter((s) => s && s !== '·')
    const [kind = '', mode = ''] = tags
    const d = m[2]
    out.push({
      source: 'Stellenwerk',
      id: m[3],
      title,
      company,
      location,
      posted_on: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`,
      url: `https://www.stellenwerk.de${m[1]}`,
      ...(kind && { hours: kind }),
      // "Homeoffice möglich" is hybrid, not remote.
      ...(/^(remote|100 ?% remote|vollständig remote|komplett remote)/i.test(mode) && { remote: true }),
    })
  }
  return out
}

/** The newest listings of the Stellenwerk regions among `places`, posted within `days`. */
export async function searchStellenwerk(places: string[], days: number): Promise<Listing[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString().slice(0, 10)
  const cities = STELLENWERK_CITIES.filter((c) => places.includes(c))
  // The region page lists the newest jobs (its later pages answer with errors); one city that fails leaves the others.
  const results = await Promise.allSettled(cities.map(async (c) => parseStellenwerk(await get(`https://www.stellenwerk.de/${c}`), c)))
  if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason
  const pages = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const out = new Map<string, Listing>()
  for (const l of pages.flat()) if (l.posted_on >= since) out.set(l.id, l)
  return [...out.values()]
}
