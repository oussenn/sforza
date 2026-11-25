import type { GermanLimit, JobType, SearchProfile } from '@shared/types'

/**
 * A first, rule-based look at a job listing against the account's search profile, as the daily job runs do it:
 * the ad's language, the German it asks for, the kind of job (Ausbildung, thesis, full-time, student job), the place
 * and the date. It is a screen, not a decision: the agent reads every candidate in full and reopens any drop that
 * looks wrong (a requirement read in the wrong clause, a relevant title in unusual words).
 */

export interface PostingFacts {
  title: string
  location: string
  /** the ad's text; without it only the title, place and date are screened */
  text?: string
  posted_on?: string
  /** the board says the job is remote */
  remote?: boolean
  distance_km?: number | null
  /** days older than the newest listing of the same search, from the LinkedIn id (boards.ts linkedInAgeDays) */
  age_days?: number | null
}

export interface Screen {
  /** candidate: worth reading in full; drop: a rule says no (reason); check: a rule could not tell */
  verdict: 'candidate' | 'drop' | 'check'
  reason: string
  ad_language?: 'en' | 'de' | 'mixed'
  /** the German the ad asks for, with the words it says it in */
  german?: { level: 'fluent' | 'good' | 'plus' | 'not mentioned'; quote: string }
  in_your_fields?: boolean
  near?: boolean | null
}

const EN = /\b(the|and|you|your|with|for|our|we|will|are|of|to|in)\b/g
const DE = /\b(und|der|die|das|wir|du|dich|deine|mit|für|bei|uns|ist|zu|von|eine?)\b/g

const HIGH = [
  /(fließend\w*|fliessend\w*|sehr gut\w*|verhandlungssicher\w*|ausgezeichnet\w*|exzellent\w*|hervorragend\w*|fundiert\w*|einwandfrei\w*|perfekt\w*|\bc1\b|\bc2\b)[^.\n]{0,60}deutsch(?!land)/,
  /deutsch(?!land)\w*[^.\n]{0,40}(fließend|fliessend|verhandlungssicher|sehr gut|\bc1\b|\bc2\b|muttersprach)/,
  /(fluent|fluency|excellent|very good|native|business[- ]fluent|proficient|full professional)[^.\n]{0,40}german(?!y)/,
  /german(?!y)[^.\n]{0,40}(fluent|\bc1\b|\bc2\b|native|business level|proficien)/,
  /muttersprach/,
]
const MID = [
  /(gut\w*|solid\w*|sicher\w*|\bb2\b)[^.\n]{0,60}deutsch(?!land)/,
  /deutsch(?!land)\w*[^.\n]{0,40}(gut|\bb2\b|sicher|in wort und schrift)/,
  /(good|strong|solid|working)[^.\n]{0,40}german(?!y)/,
  /german(?!y)[^.\n]{0,40}(\bb2\b|required|is a must|mandatory|skills are required|necessary)/,
  /(german(?!y) and english|english and german(?!y)|deutsch(?!land) und englisch|englisch und deutsch(?!land))/,
]
const PLUS =
  /(and\/or|und\/oder|or english|oder englisch|english or german|englisch oder deutsch|nicht relevant|not relevant|keine voraussetzung|not a requirement|plus|nice to have|von vorteil|wünschenswert|advantage|bonus|helpful|not required|nicht erforderlich|not necessary|keine deutsch)/
const MENTION = /deutsch(?!land)|german(?!y)/

/** The first pattern that matches outside a "nice to have" clause: "fluent German, French is a plus" stays a requirement. */
function firstRequirement(patterns: RegExp[], low: string): string {
  for (const p of patterns) {
    const m = p.exec(low)
    if (!m) continue
    const tail = low.slice(m.index + m[0].length, m.index + m[0].length + 60).split(/[.;\n]|, (?!or |oder )/)[0]
    if (!PLUS.test(m[0] + tail)) return m[0]
  }
  return ''
}

export function adLanguage(text: string): 'en' | 'de' | 'mixed' {
  const low = text.toLowerCase()
  const en = low.match(EN)?.length ?? 0
  const de = low.match(DE)?.length ?? 0
  return en > de * 1.5 ? 'en' : de > en * 1.5 ? 'de' : 'mixed'
}

export function germanAsked(text: string): NonNullable<Screen['german']> {
  const low = text.toLowerCase().replace(/#\w+/g, ' ') // hashtags like #german are not requirements
  const high = firstRequirement(HIGH, low)
  if (high) return { level: 'fluent', quote: high.slice(0, 80) }
  const mid = firstRequirement(MID, low)
  if (mid) return { level: 'good', quote: mid.slice(0, 80) }
  const any = MENTION.exec(low)
  return any ? { level: 'plus', quote: low.slice(Math.max(0, any.index - 30), any.index + 40).trim() } : { level: 'not mentioned', quote: '' }
}

/** The highest requirement each limit accepts: fluent > good > plus. */
const ACCEPTS: Record<GermanLimit, number> = { none: 1, basic: 1, B1: 1, B2: 2, C1: 3, any: 3 }
const RANK = { 'not mentioned': 0, plus: 1, good: 2, fluent: 3 } as const

// The Ruhr area as one place: a profile that names it means all of these cities.
const RUHR = 'dortmund bochum essen gelsenkirchen unna hamm hagen duisburg herne witten recklinghausen castrop lünen schwerte mülheim oberhausen bottrop gladbeck kamen marl dorsten herten bergkamen holzwickede iserlohn'.split(' ')
const NOT_PLACES = new Set('and the area region remote within germany deutschland nrw north rhine westphalia nordrhein westfalen city near around also only or und oder im in from of'.split(' '))

/** The first place a search profile names, as written ("Dortmund and the Ruhr area" → "Dortmund"), for the search's default place. */
export function firstPlace(locations: string): string {
  const first = profilePlaces(locations)[0]
  return first ? (locations.match(new RegExp(first, 'i'))?.[0] ?? first) : ''
}

/** The places a search profile names, lower case ("Ruhr area" brings its cities). */
export function profilePlaces(locations: string): string[] {
  const words = locations
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .split(/[^a-zäöüß-]+/)
    .filter((w) => w.length > 2 && !NOT_PLACES.has(w))
  return [...new Set([...words, ...(words.includes('ruhr') ? RUHR : [])])].filter((w) => w !== 'ruhr')
}

const REMOTE_AD =
  /fully remote|100 ?% remote|remote[- ]first|work from anywhere|deutschlandweit remote|vollständig remote|komplett remote|remote within germany|remote in germany|remote from (anywhere in )?germany|ortsunabhängig|100 ?% (mobil|homeoffice|home office)/

/** Whether the job is in one of the profile's places (or remote while the profile takes remote); null when the listing names no city. */
function nearProfile(f: PostingFacts, p: SearchProfile): boolean | null {
  const low = (f.text ?? '').toLowerCase()
  const remoteOk = p.workModes.includes('remote') || /remote/i.test(p.locations)
  if (remoteOk && REMOTE_AD.test(low)) return true
  if (typeof f.distance_km === 'number') return f.distance_km <= (p.radiusKm || 50)
  const loc = f.location.toLowerCase()
  if (!loc.trim() || /^(germany|deutschland|north rhine-westphalia, germany|nordrhein-westfalen)$/.test(loc.trim())) return null
  const places = profilePlaces(p.locations)
  if (!places.length) return null
  if (places.some((w) => loc.includes(w))) return true
  // A board's remote tag alone is not enough (LinkedIn tags offices far away): unknown until the ad says so (above).
  return remoteOk && f.remote ? null : false
}

const WORDS_STOP = new Set(
  'working student students werkstudent werkstudentin roles role open also same fields other and the for with in of or to as an a up per week hours jobs job internships internship m.sc. msc'.split(' '),
)

/** Whether the title uses a word of the profile's roles (fields like data, BI, software, ERP). */
export function inFields(title: string, roles: string): boolean {
  const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w)
  const want = new Set(
    roles
      .toLowerCase()
      .split(/[^a-zäöüß0-9+#]+/)
      .filter((w) => w.length > 1 && !WORDS_STOP.has(w))
      .map(stem),
  )
  // German titles say Daten, Analyse, Informatik, Entwicklung: count them as their English fields.
  const t = title
    .toLowerCase()
    .replace(/daten/g, ' data ')
    .replace(/analys|analyse|analyt/g, ' analytics ')
    .replace(/informatik/g, ' software it ')
    .replace(/entwickl/g, ' software engineering ')
    .replace(/künstliche intelligenz|\bki\b|\bai\b|\bml\b|artificial intelligence/g, ' ai machine learning ')
  return t.split(/[^a-zäöüß0-9+#]+/).some((w) => w.length > 1 && !WORDS_STOP.has(w) && want.has(stem(w)))
}

const STUDENT_TITLE = /werkstudent|working student|student|studi|praktik|intern\b|internship|trainee|minijob|mini-job|aushilfe|hilfskraft|nebenjob|teilzeit|part[- ]time|\bshk\b|\bwhk\b|hiwi/
const STUDENT_TEXT =
  /werkstudent|working student|studierende|students? (enrolled|currently)|eingeschrieben|immatrikul|teilzeit|part[- ]time|minijob|(bis zu |up to |max(imal|\.)? ?)?(1[0-9]|20) ?(std|stunden|hours|h)\b/

const KIND_PATTERNS: [JobType, RegExp][] = [
  ['working_student', /werk-?student|working student|werkstudierende|werkstudium|student worker/],
  ['minijob', /mini-?job|minijobber|geringfügig|\b(520|538|556|603) ?(€|euro)/],
  ['student_assistant', /studentische hilfskraft|wissenschaftliche hilfskraft|\bhiwi\b|\bshk\b|\bwhk\b|student assistant/],
  ['internship', /praktik|pflichtpraktikum|\bintern\b|internship/],
  ['thesis', /thesis|abschlussarbeit|masterarbeit|bachelorarbeit/],
  ['trainee', /trainee|\bausbildung\b|azubi|duales studium|dual study/],
  ['full_time', /vollzeit|full[- ]time/],
  ['part_time', /teilzeit|part[- ]time|aushilfe/],
]
const KIND_NAMES: Record<JobType, string> = {
  working_student: 'Werkstudent',
  minijob: 'Minijob',
  student_assistant: 'student assistant (HiWi)',
  internship: 'Praktikum',
  thesis: 'thesis',
  part_time: 'regular part-time job',
  full_time: 'full-time job',
  trainee: 'trainee or Ausbildung',
}

/**
 * The kinds of job a posting is: from its title, or from the ad when the title names none. "Praktikum / Werkstudent"
 * is both; an "Aushilfe" is a Minijob when the ad says so. Empty when nothing names a kind.
 */
function jobKinds(title: string, text = ''): Set<JobType> {
  const find = (s: string) => new Set(KIND_PATTERNS.filter(([, re]) => re.test(s)).map(([k]) => k))
  let kinds = find(title.toLowerCase())
  if (!kinds.size && text) kinds = find(text.toLowerCase().slice(0, 4000))
  // A Werkstudent or Minijob post is part-time by nature: "Teilzeit" beside it adds nothing.
  if (kinds.has('working_student') || kinds.has('minijob')) kinds.delete('part_time')
  if (kinds.has('part_time') && /mini-?job|geringfügig/.test(text.toLowerCase())) {
    kinds.delete('part_time')
    kinds.add('minijob')
  }
  return kinds
}

/** Screens a listing (title, place, date) or a whole posting (with its text) against the search profile. */
export function screenPosting(f: PostingFacts, p: SearchProfile, today = new Date()): Screen {
  const title = f.title.toLowerCase()
  const low = (f.text ?? '').toLowerCase()
  const types = new Set<JobType>(p.jobTypes)
  const studentTypes = types.size > 0 && !types.has('full_time')
  const near = nearProfile(f, p)
  const fields = p.roles.trim() ? inFields(f.title, p.roles) : undefined
  const out = (verdict: Screen['verdict'], reason: string, extra: Partial<Screen> = {}): Screen => ({
    verdict,
    reason,
    ...(fields !== undefined && { in_your_fields: fields }),
    near,
    ...extra,
  })

  // Date: only postings first published in the last 7 days.
  if (f.posted_on && /^\d{4}-\d{2}-\d{2}$/.test(f.posted_on)) {
    const age = Math.floor((today.getTime() - new Date(`${f.posted_on}T00:00:00Z`).getTime()) / 86_400_000)
    if (age > 7) return out('drop', `Posted ${f.posted_on}, more than 7 days ago.`)
  }
  if (typeof f.age_days === 'number' && f.age_days > 10) return out('drop', `Probably an older ad shown with a new date: its LinkedIn id is about ${f.age_days} days older than the newest listings.`)

  if (/\bausbildung\b|azubi|duales studium|dual study/.test(title) && !types.has('trainee')) return out('drop', 'Ausbildung or dual study, not a student job.')
  if (/thesis|abschlussarbeit|masterarbeit|bachelorarbeit/.test(title) && !types.has('thesis')) return out('drop', 'Thesis position, not a job.')
  if (near === false) return out('drop', `Outside your places (${f.location}).`)

  // Job kind: only the kinds the profile takes (e.g. only Werkstudent and Minijob).
  const kinds = jobKinds(f.title, f.text)
  if (types.size && kinds.size && ![...kinds].some((k) => types.has(k)))
    return out('drop', `${[...kinds].map((k) => KIND_NAMES[k]).join(' / ')}, not a job type you take (${[...types].map((t) => KIND_NAMES[t]).join(', ')}).`)
  if (types.size && !kinds.size && f.text && [...types].every((t) => t === 'working_student' || t === 'minijob'))
    return out('drop', `The ad names no Werkstudent or Minijob contract (you take only ${[...types].map((t) => KIND_NAMES[t]).join(' and ')}).`)

  if (!f.text) {
    if (near === null && f.remote) return out('check', `Listed as remote, office in ${f.location || 'an unnamed place'}: read the ad to see whether it can be done remotely.`)
    if (studentTypes && !STUDENT_TITLE.test(title)) return out('check', 'The title names no student or part-time job: read the ad for hours and student status.')
    if (fields === false) return out('check', 'The title is outside the roles in your profile: read it only if it may still fit.')
    return out('candidate', 'Read the ad in full.')
  }

  const fullTime = /vollzeit|full[- ]time|40 ?(std|stunden|hours)/.test(low) && !/werkstudent|working student|teilzeit|part[- ]time|minijob|aushilfe|student/.test(`${title} ${low.slice(0, 400)}`)
  if (studentTypes && fullTime) return out('drop', 'Full-time role, not a student job.')
  if (studentTypes && !STUDENT_TITLE.test(title) && !STUDENT_TEXT.test(low)) return out('drop', 'Not a student or part-time role (no hours or student status in the ad).')

  const language = adLanguage(low)
  const german = germanAsked(low)
  const limit = p.germanLimit ?? 'basic'
  const extra = { ad_language: language, german }
  if (RANK[german.level] > ACCEPTS[limit]) return out('drop', `German required above your limit: "${german.quote}".`, extra)
  if ((limit === 'none' || limit === 'basic') && language === 'de') return out('drop', 'German-language ad: the daily work is in German.', extra)
  if (fields === false) return out('check', 'Outside the roles in your profile: read it and decide.', extra)
  return out('candidate', 'Fits the rules of your profile: read it in full and judge the fit.', extra)
}
