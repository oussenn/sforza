import { AiError } from './ai'

/**
 * Job search on the Bundesagentur für Arbeit's job board (Germany's largest; it also lists many postings from
 * company career pages and other boards). Public API of the official app, documented at jobsuche.api.bund.dev.
 */

const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service'
const HEADERS = { 'X-API-Key': 'jobboerse-jobsuche', Accept: 'application/json' }

type Json = Record<string, unknown>

export interface JobSearchQuery {
  /** keywords, e.g. "Werkstudent Data Engineering" */
  what: string
  /** city or postcode */
  where: string
  radiusKm: number
  /** 'job' = regular jobs incl. working students, 'internship' = internships and trainee programmes */
  kind: 'any' | 'job' | 'internship'
  partTime: boolean
  /** posted within the last N days (1–100) */
  days: number
  page: number
  size: number
}

export interface JobHit {
  title: string
  company: string
  location: string
  distance_km: number | null
  kind: string
  hours: string
  remote: string
  first_published: string
  start: string
  /** the posting on arbeitsagentur.de */
  url: string
  /** the original posting (company site or other board), when the ad links one */
  external_url: string
  ref: string
}

const KIND: Record<string, string> = {
  ARBEIT: 'job',
  PRAKTIKUM_TRAINEE: 'internship / trainee / working student',
  AUSBILDUNG: 'apprenticeship',
  SELBSTAENDIGKEIT: 'self-employed',
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const baJobUrl = (ref: string) => `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(ref)}`

function place(job: Json): string {
  const loc = ((job.stellenlokationen as Json[] | undefined) ?? [])[0]?.adresse as Json | undefined
  return [str(loc?.ort), str(loc?.plz)].filter(Boolean).join(' ')
}

function hours(job: Json): string {
  const out: string[] = []
  if (job.arbeitszeitVollzeit) out.push('full-time')
  if (job.arbeitszeitTeilzeitFlexibel || job.arbeitszeitTeilzeitVormittag || job.arbeitszeitTeilzeitNachmittag || job.arbeitszeitTeilzeitAbend) {
    out.push('part-time')
  }
  if (job.istGeringfuegigeBeschaeftigung) out.push('mini-job')
  return out.join(', ')
}

function hit(job: Json): JobHit {
  const ref = str(job.referenznummer)
  return {
    title: str(job.stellenangebotsTitel) || str(job.titel),
    company: str(job.firma) || str(job.arbeitgeber),
    location: place(job),
    distance_km: typeof job.entfernung === 'number' ? job.entfernung : null,
    kind: KIND[str(job.stellenangebotsart)] ?? str(job.stellenangebotsart).toLowerCase(),
    hours: hours(job),
    remote: job.homeofficemoeglich ? 'home office possible' : '',
    first_published: str(job.datumErsteVeroeffentlichung),
    start: str((job.eintrittszeitraum as Json | undefined)?.von),
    url: ref ? baJobUrl(ref) : '',
    external_url: str(job.externeURL),
    ref,
  }
}

export async function searchBa(q: JobSearchQuery): Promise<{ total: number; page: number; jobs: JobHit[] }> {
  const params = new URLSearchParams({
    was: q.what,
    wo: q.where,
    umkreis: String(q.radiusKm),
    page: String(q.page),
    size: String(q.size),
    veroeffentlichtseit: String(q.days),
  })
  // No place: search all of Germany.
  if (!q.where.trim()) {
    params.delete('wo')
    params.delete('umkreis')
  }
  if (q.kind === 'job') params.set('angebotsart', '1')
  if (q.kind === 'internship') params.set('angebotsart', '34')
  if (q.partTime) params.set('arbeitszeit', 'tz')
  const res = await fetch(`${BASE}/pc/v6/jobs?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) throw new AiError(`The Arbeitsagentur job search did not answer (${res?.status ?? 'network error'}). Search in the browser instead.`)
  const data = (await res.json()) as Json
  const list = ((data.ergebnisliste ?? data.stellenangebote) as Json[] | undefined) ?? []
  return { total: typeof data.maxErgebnisse === 'number' ? data.maxErgebnisse : list.length, page: q.page, jobs: list.map(hit) }
}

/** Reference number of an arbeitsagentur.de posting link. */
export function baRef(url: URL): string | null {
  if (!/(^|\.)arbeitsagentur\.de$/.test(url.hostname)) return null
  return decodeURIComponent(url.pathname.match(/\/jobsuche\/jobdetail\/([^/?#]+)/)?.[1] ?? '') || null
}

/** The full posting of a reference number, or null when it is unknown or gone. */
export async function baPosting(ref: string): Promise<(JobHit & { description: string; website: string }) | null> {
  const res = await fetch(`${BASE}/pc/v4/jobdetails/${btoa(ref)}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) return null
  const job = (await res.json()) as Json
  // The texts sometimes carry empty "<>" tags.
  const description = str(job.stellenangebotsBeschreibung).replace(/<>/g, '').trim()
  if (!description) return null
  return { ...hit({ ...job, referenznummer: str(job.referenznummer) || ref }), description, website: str(job.allianzpartnerUrl) }
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\((?:[mwfdx]\s*[/|,]\s*)+[mwfdx]\)|\b[mwfdx]\/[mwfdx]\/[mwfdx]\b|all genders|w\/m\/d|m\/w\/d|d\/w\/m/g, ' ')
    .split(/[^a-z0-9äöüß]+/)
    .filter((w) => w.length > 2)

/** Share of the posting's title words that the other title has too. */
function overlap(title: string, other: string): number {
  const mine = new Set(words(title))
  if (!mine.size) return 0
  const theirs = new Set(words(other))
  return [...mine].filter((w) => theirs.has(w)).length / mine.size
}

/**
 * The same job on the Arbeitsagentur board, found by company and title: its listing often links the company's own
 * posting (external_url), which a LinkedIn guest page hides. Null when no listing matches closely.
 */
export async function findOnBa(title: string, company: string): Promise<JobHit | null> {
  const firm = words(company).filter((w) => !['gmbh', 'ag', 'se', 'kg', 'group', 'the', 'und'].includes(w))
  if (!firm.length || !title.trim()) return null
  const sameFirm = (hit: JobHit) => firm.some((w) => words(hit.company).includes(w))
  const queries = [`${company} ${words(title)[0] ?? ''}`.trim(), company]
  let best: { hit: JobHit; score: number } | null = null
  for (const what of queries) {
    const { jobs } = await searchBa({ what, where: '', radiusKm: 0, kind: 'any', partTime: false, days: 60, page: 1, size: 50 }).catch(() => ({ jobs: [] as JobHit[] }))
    for (const hit of jobs.filter(sameFirm)) {
      const score = overlap(title, hit.title)
      if (score >= 0.6 && (!best || score > best.score)) best = { hit, score }
    }
    if (best && best.score >= 0.8) break
  }
  return best?.hit ?? null
}
