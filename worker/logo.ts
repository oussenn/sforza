import { decodeEntities, findJobPosting, jsonLdBlocks, linkedInJobId, USER_AGENT } from './scrape'
import { putAsset, type Store } from './db'
import { fetchPublic, readCapped, readText } from './net'

/**
 * Company logos for applications and tailored CVs, found without AI:
 * 1. what the job page states: the schema.org hiringOrganization logo, LinkedIn's company logo, the job
 *    board's header logo (Lever, Greenhouse, Personio, SmartRecruiters, Workday expose it as og:image),
 * 2. the company website's own icon when the website is known (apple-touch-icon, then Google's favicon service).
 * The image is copied into the assets table, so it keeps working when the job board's link expires.
 */

/** Hosts that list other companies' jobs: their favicon is not the employer's logo. */
const JOB_BOARDS =
  /(^|\.)(linkedin\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|ashbyhq\.com|personio\.(de|com)|welcometothejungle\.com|stepstone\.[a-z.]+|indeed\.[a-z.]+|glassdoor\.[a-z.]+|xing\.com|join\.com|recruitee\.com|workable\.com|teamtailor\.com|bamboohr\.com|jobvite\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|breezy\.hr|softgarden\.(io|de)|dvinci-hr\.com|rexx-systems\.com|hellowork\.com|apec\.fr|francetravail\.fr|arbeitsagentur\.de|jobteaser\.com|monster\.[a-z.]+|kununu\.com|jobware\.de|jobs\.ch|jobup\.ch|karriere\.at|wellfound\.com|otta\.com|builtin\.com|ziprecruiter\.com|google\.com|goo\.gl|bit\.ly|lnkd\.in)$/i

const isJobBoard = (host: string) => JOB_BOARDS.test(host)

const MAX_BYTES = 600_000

function absolute(raw: string | undefined, base: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(decodeEntities(raw.trim()), base)
    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find((v) => v != null)

interface Hints {
  images: string[]
  sites: string[]
}

/** Logo images and company websites mentioned by a job page. */
function logoHints(html: string, pageUrl: string): Hints {
  const images: string[] = []
  const sites: string[] = []
  const add = (list: string[], raw: string | undefined) => {
    const url = absolute(raw, pageUrl)
    if (url && !list.includes(url)) list.push(url)
  }
  const orgLogo = (org: unknown) => {
    if (!org || typeof org !== 'object') return
    const o = org as Record<string, unknown>
    const logo = o.logo
    add(images, typeof logo === 'string' ? logo : (logo as Record<string, string> | undefined)?.url ?? (logo as Record<string, string> | undefined)?.contentUrl)
    for (const site of [o.sameAs, o.url].flat()) if (typeof site === 'string') add(sites, site)
  }

  for (const data of jsonLdBlocks(html)) orgLogo(findJobPosting(data)?.hiringOrganization)

  // LinkedIn's guest job page shows the company logo in its top card.
  add(images, html.match(/data-delayed-url="(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*company-logo[^"]*)"/)?.[1])
  // Greenhouse boards embed {"logo":{"href":<company site>,"url":<logo>}} in their page data.
  const gh = html.match(/"logo":\{"href":("[^"]*"|null),"url":("[^"]*"|null)\}/)
  if (gh) {
    add(images, gh[2] !== 'null' ? JSON.parse(gh[2]) : undefined)
    add(sites, gh[1] !== 'null' ? JSON.parse(gh[1]) : undefined)
  }
  // Job boards use the employer's logo as the sharing image; elsewhere it is usually a banner.
  for (const tag of html.match(/<meta[^>]+(?:og:image|twitter:image)[^>]*>/gi) ?? []) {
    const content = attr(tag, 'content')
    if (content && /logo/i.test(content)) add(images, content)
  }

  const host = new URL(pageUrl).hostname
  if (!isJobBoard(host)) {
    for (const icon of iconLinks(html)) add(images, icon)
    add(sites, new URL(pageUrl).origin)
  }
  return { images, sites: sites.filter((s) => !isJobBoard(new URL(s).hostname)) }
}

/** apple-touch-icon and large icons declared by a page, best first. */
function iconLinks(html: string): string[] {
  const found: { href: string; size: number }[] = []
  for (const tag of html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi) ?? []) {
    const href = attr(tag, 'href')
    if (!href) continue
    const rel = attr(tag, 'rel') ?? ''
    const sizes = attr(tag, 'sizes') ?? ''
    const size = /apple-touch-icon/i.test(rel) ? 180 : /svg/i.test(attr(tag, 'type') ?? href) ? 150 : Number(sizes.match(/(\d+)x\d+/)?.[1] ?? 16)
    found.push({ href, size })
  }
  return found
    .filter((f) => f.size >= 48)
    .sort((a, b) => b.size - a.size)
    .map((f) => f.href)
}

/* ------------------------------------------------------------------ */
/* Downloading                                                          */
/* ------------------------------------------------------------------ */

interface Image {
  mime: string
  bytes: Uint8Array
}

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon'
  const head = new TextDecoder().decode(b.subarray(0, 300)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return null
}

/** Pixel width of a PNG, or null for other formats. */
function pngWidth(b: Uint8Array): number | null {
  return b[0] === 0x89 && b.length > 24 ? ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0 : null
}

async function fetchImage(url: string, minWidth = 0): Promise<Image | null> {
  // Image addresses come from the job page: only public hosts, and never more than MAX_BYTES read.
  const res = await fetchPublic(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8' },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null)
  if (!res?.ok) {
    await res?.body?.cancel().catch(() => undefined)
    return null
  }
  const body = await readCapped(res, MAX_BYTES).catch(() => null)
  if (!body || body.cut || body.bytes.byteLength < 100) return null
  const bytes = body.bytes
  const mime = sniff(bytes)
  if (!mime) return null
  const width = pngWidth(bytes)
  if (minWidth && width != null && width < minWidth) return null
  return { mime, bytes }
}

async function store(db: Store, image: Image): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', image.bytes))
  const id = `logo_${Array.from(digest.subarray(0, 10), (b) => b.toString(16).padStart(2, '0')).join('')}`
  let bin = ''
  for (let i = 0; i < image.bytes.length; i += 0x8000) bin += String.fromCharCode(...image.bytes.subarray(i, i + 0x8000))
  await putAsset(db, id, image.mime, btoa(bin))
  return `/api/assets/${id}`
}

async function getHtml(url: string): Promise<string> {
  const res = await fetchPublic(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res?.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
    await res?.body?.cancel().catch(() => undefined)
    return ''
  }
  return readText(res, 2_000_000).catch(() => '')
}

/**
 * Finds, downloads and stores the employer's logo for a job link. `html` is the job page when the caller
 * already fetched it. Returns the asset URL, or '' when nothing usable was found. Never throws.
 */
export async function findLogo(env: Env, jobUrl: string, html?: string): Promise<string> {
  try {
    const url = new URL(jobUrl)
    let page = html ?? ''
    if (!page) {
      const linkedIn = linkedInJobId(url)
      page = await getHtml(linkedIn ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedIn}` : url.toString())
    }
    const hints = logoHints(page, url.toString())
    for (const image of hints.images.slice(0, 4)) {
      const found = await fetchImage(image)
      if (found) return await store(env, found)
    }
    // Fall back to the company website's icon.
    for (const site of hints.sites.slice(0, 2)) {
      const home = new URL(site)
      const icons = iconLinks(await getHtml(home.origin)).map((href) => absolute(href, home.origin)).filter((u): u is string => !!u)
      for (const icon of [...icons.slice(0, 2), `${home.origin}/apple-touch-icon.png`]) {
        const found = await fetchImage(icon, 48)
        if (found) return await store(env, found)
      }
      const favicon = await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(home.hostname)}&sz=128`, 32)
      if (favicon) return await store(env, favicon)
    }
  } catch (err) {
    console.warn('Logo lookup failed', jobUrl, err)
  }
  return ''
}
