import { FONTS, LABELS, TEMPLATE_MAP } from './templates'
import type {
  Application,
  BoardColumn,
  BuiltinStage,
  Contact,
  ContactType,
  CoverLetter,
  ItemSection,
  Lang,
  LetterLayout,
  LetterStyle,
  Personal,
  Placement,
  Resume,
  ResumeContent,
  ResumeStyle,
  ResumeMeta,
  Section,
  SectionItem,
  SearchProfile,
  SectionType,
  Stage,
  TemplateId,
} from './types'
import { CONTACT_TYPES, DOC_LANGS, GERMAN_LIMITS, JOB_TYPES, LANGS, STAGE_LABELS, STAGES, WORK_MODES } from './types'

export function uid(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const id = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
  return prefix ? `${prefix}_${id}` : id
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Small, stable string hash (FNV-1a) used to detect stale translations. */
function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function contentHash(content: ResumeContent | undefined): string {
  return content ? hashString(JSON.stringify(content)) : ''
}

export function isItemSection(section: Section): section is ItemSection {
  return section.type !== 'summary'
}

export function newItem(type: Exclude<SectionType, 'summary'>): SectionItem {
  const id = uid('it')
  switch (type) {
    case 'experience':
      return { id, position: '', company: '', url: '', location: '', start: '', end: '', current: false, description: '' }
    case 'projects':
      return { id, name: '', subtitle: '', url: '', start: '', end: '', description: '' }
    case 'education':
      return { id, degree: '', school: '', url: '', location: '', start: '', end: '', current: false, description: '' }
    case 'skills':
      return { id, name: '', details: '', level: 0 }
    case 'certifications':
      return { id, name: '', issuer: '', date: '', url: '' }
    case 'languages':
      return { id, name: '', level: '', rating: 0 }
    case 'custom':
      return { id, title: '', subtitle: '', location: '', start: '', end: '', url: '', description: '' }
  }
}

export function newSection(type: SectionType, lang: Lang, template: TemplateId): Section {
  const id = uid('sec')
  const title = LABELS[lang].sections[type]
  const placement: Placement = TEMPLATE_MAP[template].placement[type] ?? 'main'
  const common = { id, title, visible: true, placement }
  if (type === 'summary') return { ...common, type, text: '' }
  return { ...common, type, items: [] } as Section
}

export function newContact(type: Contact['type'] = 'website'): Contact {
  return { id: uid('c'), type, value: '', url: '' }
}

/** Languages that currently have content, source language first. */
export function availableLangs(resume: Pick<Resume, 'content' | 'sourceLang'>): Lang[] {
  const langs = LANGS.filter((l) => resume.content[l])
  return [resume.sourceLang, ...langs.filter((l) => l !== resume.sourceLang)].filter((l) => resume.content[l])
}

export function toMeta(resume: Resume): ResumeMeta {
  return {
    id: resume.id,
    name: resume.name,
    kind: resume.kind,
    baseId: resume.baseId,
    isMain: resume.isMain,
    template: resume.template,
    photo: resume.photo,
    langs: availableLangs(resume),
    sourceLang: resume.sourceLang,
    job: resume.job
      ? { title: resume.job.title, company: resume.job.company, matchScore: resume.job.matchScore, logo: resume.job.logo ?? '' }
      : null,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  }
}

/** Apply the template's recommended placement to every section. */
export function applyTemplatePlacement(content: ResumeContent, template: TemplateId): void {
  const placement = TEMPLATE_MAP[template].placement
  for (const section of content.sections) {
    section.placement = placement[section.type] ?? 'main'
  }
}

export function isStale(resume: Resume, lang: Lang): boolean {
  if (lang === resume.sourceLang || !resume.content[lang]) return false
  const meta = resume.translations[lang]
  if (!meta) return true
  return meta.sourceHash !== contentHash(resume.content[resume.sourceLang])
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Put in front of every PDF file name so the user's files sort first in a folder listing. */
const FILE_PREFIX = '1. '

/** "1. Jane_Doe_Resume", the same for every CV and language. */
export function pdfFileName(resume: Pick<Resume, 'content' | 'sourceLang' | 'job'>, lang: Lang): string {
  const name = resume.content[lang]?.personal.name ?? resume.content[resume.sourceLang]?.personal.name ?? 'CV'
  // No job title or language: recruiters should not see that the CV was tailored.
  return `${FILE_PREFIX}${slugify(name)}_Resume`
}

/* --------------------------------- stages --------------------------------- */

const CUSTOM_STAGE = new RegExp(`^col_(${STAGES.join('|')})_[a-z0-9]{4,16}$`)
const MAX_COLUMNS = 12

export function isCustomStage(value: unknown): value is BoardColumn['id'] {
  return typeof value === 'string' && CUSTOM_STAGE.test(value)
}

export function isStage(value: unknown): value is Stage {
  return (STAGES as readonly unknown[]).includes(value) || isCustomStage(value)
}

/** The built-in stage a stage counts as: itself, or the one a custom column follows. */
export function baseStage(stage: Stage): BuiltinStage {
  return isCustomStage(stage) ? (stage.split('_')[1] as BuiltinStage) : stage
}

/** Id of a new column placed after `after`. */
export function newColumnId(after: BuiltinStage): BoardColumn['id'] {
  return uid(`col_${after}`) as BoardColumn['id']
}

export function stageLabel(stage: Stage, columns: readonly BoardColumn[] = []): string {
  if (!isCustomStage(stage)) return STAGE_LABELS[stage]
  return columns.find((c) => c.id === stage)?.label ?? STAGE_LABELS[baseStage(stage)]
}

/** Every column of the board in order: each built-in stage followed by the custom columns placed after it. */
export function boardStages(columns: readonly BoardColumn[]): Stage[] {
  return STAGES.flatMap((s) => [s, ...columns.filter((c) => baseStage(c.id) === s).map((c) => c.id)])
}

/** Custom columns from untrusted input: valid ids, trimmed labels, no duplicates. */
export function cleanBoardColumns(raw: unknown): BoardColumn[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: BoardColumn[] = []
  for (const c of raw as { id?: unknown; label?: unknown }[]) {
    const label = typeof c?.label === 'string' ? c.label.trim().slice(0, 40) : ''
    if (!isCustomStage(c?.id) || !label || seen.has(c.id)) continue
    seen.add(c.id)
    out.push({ id: c.id, label })
  }
  return out.slice(0, MAX_COLUMNS)
}

/** Stages before the application is sent (custom columns count as the stage they follow). */
export function isUnsent(stage: Stage): boolean {
  const base = baseStage(stage)
  return base === 'saved' || base === 'draft'
}

/** Stages from which the application counts as sent and gets an applied date. */
export function isSentStage(stage: Stage): boolean {
  return ['applied', 'interview', 'offer'].includes(baseStage(stage))
}

export function newApplication(fields: Partial<Application>, now: string): Application {
  const stage = fields.stage ?? 'saved'
  return {
    stage,
    // newest first
    order: -Date.now(),
    title: '',
    company: '',
    logo: '',
    url: '',
    location: '',
    salary: '',
    resumeId: null,
    lang: null,
    appliedOn: isUnsent(stage) ? '' : now.slice(0, 10),
    nextStep: '',
    nextDate: '',
    contact: '',
    notes: '',
    description: '',
    history: [{ stage, at: now }],
    ...fields,
    id: uid('app'),
    createdAt: now,
    updatedAt: now,
  }
}

/** Job links without tracking parameters, for spotting the same posting twice. */
export function jobUrlKey(raw: string): string {
  try {
    const noise = /^(utm_|trk|ref|tracking|src$|source$|gh_src$|lipi$|origin$|locale$|lang$|language$)/i
    const url = new URL(raw.trim())
    // LinkedIn shows one job under many links (search results with ?currentJobId=, /jobs/view/<slug>-<id>): key it by its id.
    const linkedIn = /(^|\.)linkedin\.com$/.test(url.hostname)
      ? (url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? url.searchParams.get('currentJobId')?.match(/^\d{6,}$/)?.[0])
      : null
    if (linkedIn) return `linkedin.com/jobs/view/${linkedIn}`
    for (const key of [...url.searchParams.keys()]) if (noise.test(key)) url.searchParams.delete(key)
    // Single-page career sites keep the job in the hash (jobs.amazon.de/app#/jobDetail?jobId=…): keep that route.
    let route = ''
    if (url.hash.startsWith('#/')) {
      const inner = new URL(url.hash.slice(1), 'https://route.invalid')
      for (const key of [...inner.searchParams.keys()]) if (noise.test(key)) inner.searchParams.delete(key)
      route = `#${inner.pathname}${inner.search}`
    }
    url.hash = ''
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}${route}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

const BOARDS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)indeed\.[a-z.]+$/, 'Indeed'],
  [/(^|\.)stepstone\.[a-z.]+$/, 'StepStone'],
  [/(^|\.)xing\.com$/, 'XING'],
  [/(^|\.)glassdoor\.[a-z.]+$/, 'Glassdoor'],
  [/(^|\.)welcometothejungle\.com$/, 'Welcome to the Jungle'],
  [/(^|\.)arbeitsagentur\.de$/, 'Bundesagentur für Arbeit'],
  [/(^|\.)jobteaser\.com$/, 'JobTeaser'],
  [/(^|\.)(greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|ashbyhq\.com|personio\.(de|com)|softgarden\.(io|de)|join\.com|recruitee\.com|workable\.com|teamtailor\.com)$/, 'Company career page'],
]

/** Where a job link comes from: "LinkedIn", "Indeed", "Company career page" or the site's domain. */
export function jobSource(raw: string): string {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase()
    return BOARDS.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const LETTER_WORD: Record<Lang, string> = { en: 'Cover_Letter', fr: 'Lettre_de_motivation', de: 'Anschreiben' }

/** "1. Jane_Doe_Anschreiben": like the CV, without the job title. */
export function letterFileName(name: string, lang: Lang): string {
  return `${FILE_PREFIX}${slugify(name || 'Letter')}_${LETTER_WORD[lang]}`
}

/** The city of the CV's location contact ("Berlin, Germany" → "Berlin"). */
export function cityOf(content: Pick<ResumeContent, 'personal'>): string {
  return (content.personal.contacts.find((c) => c.type === 'location')?.value ?? '').split(/[,/·]/)[0].trim()
}

/** "Berlin, 12. Oktober 2026" / "Berlin, le 12 octobre 2026" / "Berlin, 12 October 2026" */
export function letterDateLine(date: string, lang: Lang, city: string): string {
  const d = new Date(`${date || new Date().toISOString().slice(0, 10)}T12:00:00Z`)
  const locale = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE' }[lang]
  const formatted = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  if (!city) return formatted
  return lang === 'fr' ? `${city}, le ${formatted}` : `${city}, ${formatted}`
}

/** Salutation and closing used when a letter is started by hand. */
/** German letters follow DIN 5008 unless chosen otherwise; English and French ones use the CV-styled layout. */
export function letterLayoutOf(letter: Pick<CoverLetter, 'layout'>, lang: Lang): LetterLayout {
  return letter.layout ?? (lang === 'de' ? 'din5008' : 'modern')
}

/** Limits of a letter's style, also what the Design panel's sliders allow. */
export const LETTER_STYLE_LIMITS = {
  fontSize: [10, 13],
  lineHeight: [1.1, 1.8],
  marginX: [12, 32],
  marginY: [10, 30],
  paragraphGap: [0, 1.5],
} as const satisfies Record<string, readonly [number, number]>

/** The look a letter prints with: what the user chose in its Design panel, the rest from the linked CV. */
export function letterStyleOf(cv: ResumeStyle, own: Partial<LetterStyle> | undefined, layout: LetterLayout): LetterStyle {
  const din = layout === 'din5008'
  const style: LetterStyle = {
    font: cv.font,
    headingFont: cv.headingFont,
    accent: cv.accent,
    text: cv.text,
    background: cv.background,
    // Letters read best a little larger than the CV's body text; DIN 5008 asks for at least 11 pt.
    fontSize: din ? 11 : Math.max(10.5, cv.fontSize + 1),
    lineHeight: din ? 1.2 : 1.45,
    marginX: 22,
    marginY: 18,
    // DIN 5008 leaves one blank line between paragraphs.
    paragraphGap: din ? 1 : 0.55,
    ...cleanLetterStyle(own),
  }
  if (din) style.fontSize = Math.max(11, style.fontSize)
  return style
}

/** The valid fields of a letter style from the editor or an agent; anything else is dropped. */
export function cleanLetterStyle(value: unknown): Partial<LetterStyle> {
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const out: Partial<LetterStyle> = {}
  if (typeof v.font === 'string' && (FONTS as readonly string[]).includes(v.font)) out.font = v.font
  if (v.headingFont === '' || (typeof v.headingFont === 'string' && (FONTS as readonly string[]).includes(v.headingFont))) out.headingFont = v.headingFont
  for (const k of ['accent', 'text', 'background'] as const) if (typeof v[k] === 'string' && /^#[0-9a-f]{6}$/i.test(v[k])) out[k] = v[k].toLowerCase()
  for (const [k, [min, max]] of Object.entries(LETTER_STYLE_LIMITS) as [keyof typeof LETTER_STYLE_LIMITS, readonly [number, number]][]) {
    const n = v[k]
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = Math.min(max, Math.max(min, Math.round(n * 100) / 100))
  }
  return out
}

export const ENCLOSURES: Record<Lang, { label: string; default: string }> = {
  en: { label: 'Enclosures', default: 'CV' },
  fr: { label: 'Pièces jointes', default: 'CV' },
  de: { label: 'Anlagen', default: 'Lebenslauf' },
}

/** Enclosure lines of a letter, from commas or line breaks. */
export function enclosureLines(enclosures: string | undefined): string[] {
  return (enclosures ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export const LETTER_FRAME: Record<Lang, { salutation: string; closing: string }> = {
  en: { salutation: 'Dear Hiring Team,', closing: 'Kind regards,' },
  fr: { salutation: 'Madame, Monsieur,', closing: 'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.' },
  de: { salutation: 'Sehr geehrte Damen und Herren,', closing: 'Mit freundlichen Grüßen' },
}

/** An item's heading as the CV shows it: role or name, then company, school or issuer. */
export function itemHead(item: SectionItem): string {
  const i = item as unknown as Record<string, string | undefined>
  return [i.position ?? i.degree ?? i.name ?? i.title, i.company ?? i.school ?? i.issuer ?? i.subtitle].filter(Boolean).join(' – ')
}

/** A CV as readable Markdown: for agents, and as plain text for AI-text detectors. */
export function cvMarkdown(content: ResumeContent): string {
  const out = [`# ${content.personal.name}`, content.personal.headline, content.personal.contacts.map((c) => c.value.trim()).filter(Boolean).join(' · ')]
  for (const s of content.sections) {
    if (!s.visible) continue
    out.push(`\n## ${s.title}`)
    if (!isItemSection(s)) {
      out.push(s.text)
      continue
    }
    for (const item of s.items) {
      if (item.hidden) continue
      const i = item as unknown as Record<string, string | boolean | number>
      const head = itemHead(item)
      const when = [i.start, i.current ? 'Present' : i.end].filter(Boolean).join(' – ')
      const line = [head, i.level, i.location, when].filter((x) => x && typeof x === 'string').join(' | ')
      out.push(`- ${line}${i.details ? `: ${i.details}` : ''}`)
      if (typeof i.description === 'string' && i.description) out.push(i.description.replace(/^/gm, '  '))
    }
  }
  return out.filter((l) => l !== undefined).join('\n')
}

/** The text a detector should read: prose and bullets without Markdown markup. */
export function detectorText(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Em dashes read as AI-written, so CVs, letters and form answers never contain one, whoever wrote the text: a range
 * keeps an en dash ("2019–2022"), a line that starts with one becomes a bullet, any other turns into a comma.
 */
export function noEmDash(text: string): string {
  if (!/[—―]/.test(text)) return text
  return text
    .replace(/(\d)[ \t]*[—―][ \t]*(?=\d)/g, '$1–')
    .replace(/^([ \t]*)[—―][ \t]*/gm, '$1- ')
    .replace(/[ \t]*[—―][ \t]*/g, ', ')
    .replace(/,[ \t]*([,.;:!?)\]])/g, '$1')
    .replace(/,[ \t]*$/gm, '')
}

/** Every text of a CV's content, in every language, without em dashes. */
export function cvWithoutEmDashes<T extends { content: Partial<Record<Lang, ResumeContent>> }>(resume: T): T {
  const walk = (v: unknown): unknown =>
    typeof v === 'string' ? noEmDash(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v
  return { ...resume, content: walk(resume.content) as T['content'] }
}

/** An application's letters and form answers without em dashes (the posting and the user's notes stay as they are). */
export function applicationWithoutEmDashes(app: Application): Application {
  const letters = app.letters
    ? (Object.fromEntries(
        Object.entries(app.letters).map(([l, letter]) => [
          l,
          letter && { ...letter, subject: noEmDash(letter.subject), recipient: noEmDash(letter.recipient), body: noEmDash(letter.body) },
        ]),
      ) as Application['letters'])
    : app.letters
  const formAnswers = app.formAnswers?.map((a) => ({ ...a, answer: noEmDash(a.answer) }))
  return { ...app, letters, formAnswers }
}

/** Common-sense rules every tailored CV follows, in any account; each user adds their own in the search profile (cvRules). */
export const CV_RULES = [
  'Adapt it to the posting: find its must-haves first, then lead with the bullets, projects and skills that prove them. Use the posting’s word where the material says the same thing.',
  'Only facts from the master CV and the knowledge base. Never add a skill, tool, number, title or task to match the posting, and never point out a missing one: gaps go in the notes.',
  'Job titles, employers, dates, degrees and grades exactly as the material states them: never upgrade a role or stretch a date.',
  'Keep every job of the master CV, so the timeline has no holes: cut a less relevant one down to one or two bullets instead of dropping it.',
  'Language levels and skill qualifiers exactly as on the master CV ("basics" stays basics), never raised or lowered for one posting.',
  'Leave out figures the knowledge base marks as unverified or still to be checked.',
  'One company, one story: every application to the same company shows the same facts (contact details, levels, dates).',
  'Exactly one page, completely filled, every section whole. To make room, hide the least relevant items first (school diploma, weaker bullets, projects or skill groups) and keep the font at 9 pt or more.',
  'No em dashes (—), in any language: use a comma, a colon or a new sentence. They read as AI-written; the app removes any that slip through.',
] as const

export function defaultSearchProfile(): SearchProfile {
  return {
    roles: '',
    country: '',
    locations: '',
    radiusKm: 50,
    // This deployment: accounts without a saved profile search student jobs (the public release starts empty).
    jobTypes: ['working_student', 'student_assistant', 'internship'],
    workModes: ['onsite', 'hybrid', 'remote'],
    germanLevel: '',
    germanLimit: 'basic',
    availability: '',
    start: '',
    salary: '',
    workPermit: '',
    targets: '',
    sites: '',
    avoid: '',
    docLangs: 'posting+en',
    maxAiPercent: 10,
    perRun: 5,
    minFit: 60,
    notes: '',
    cvRules: '',
    letterHideContacts: [],
  }
}

/** A search profile from untrusted input: unknown keys dropped, values clamped, missing ones defaulted. */
export function cleanSearchProfile(raw: unknown, base: SearchProfile = defaultSearchProfile()): SearchProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (k: keyof SearchProfile, max = 4000) => (typeof r[k] === 'string' ? (r[k] as string).slice(0, max) : (base[k] as string))
  const num = (k: keyof SearchProfile, min: number, max: number) =>
    typeof r[k] === 'number' && Number.isFinite(r[k]) ? Math.min(max, Math.max(min, Math.round(r[k] as number))) : (base[k] as number)
  const pick = <T extends string>(k: keyof SearchProfile, allowed: readonly T[]) =>
    Array.isArray(r[k]) ? [...new Set((r[k] as unknown[]).filter((v): v is T => allowed.includes(v as T)))] : (base[k] as T[])
  const one = <T extends string>(k: keyof SearchProfile, allowed: readonly T[]) =>
    allowed.includes(r[k] as T) ? (r[k] as T) : (base[k] as T)
  return {
    roles: text('roles'),
    country: text('country', 60),
    locations: text('locations'),
    radiusKm: num('radiusKm', 0, 200),
    jobTypes: pick('jobTypes', JOB_TYPES),
    workModes: pick('workModes', WORK_MODES),
    germanLevel: text('germanLevel', 60),
    germanLimit: one('germanLimit', GERMAN_LIMITS),
    availability: text('availability', 1000),
    start: text('start', 200),
    salary: text('salary', 200),
    workPermit: text('workPermit', 1000),
    targets: text('targets'),
    sites: text('sites', 6000),
    avoid: text('avoid'),
    docLangs: one('docLangs', DOC_LANGS),
    maxAiPercent: num('maxAiPercent', 0, 100),
    perRun: num('perRun', 1, 20),
    minFit: num('minFit', 0, 100),
    notes: text('notes', 8000),
    cvRules: text('cvRules'),
    letterHideContacts: pick('letterHideContacts', CONTACT_TYPES),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 40) : base.updatedAt,
  }
}

/** The sender block of a letter: the CV's name and contacts without the ones the account leaves off letters. */
export function letterPersonal(personal: Personal, hidden: readonly ContactType[] | undefined): Personal {
  return hidden?.length ? { ...personal, contacts: personal.contacts.filter((c) => !hidden.includes(c.type)) } : personal
}

/** Whether the job search is in Germany: German-level rules, Werkstudent job kinds and the Bundesagentur board apply. */
export function searchesGermany(p: Pick<SearchProfile, 'country'>): boolean {
  const c = (p.country ?? '').trim().toLowerCase()
  return !c || ['de', 'germany', 'deutschland', 'allemagne'].includes(c)
}

/** Availability, start date and permit from the search profile: facts a motivation letter may state. */
export function profileFacts(p: Pick<SearchProfile, 'availability' | 'start' | 'workPermit'>): string {
  return [
    p.availability && `Availability: ${p.availability}`,
    p.start && `Earliest start: ${p.start}`,
    p.workPermit && `Work permit: ${p.workPermit}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Job titles without gender tags ("(m/w/d)", "(all genders)"), for spotting one posting on several boards. */
export function titleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((?:[mwfdx]\s*\/\s*){1,3}[mwfdx]\)|\((?:all genders?|alle geschlechter|gn\*?)\)|\b[mwfdx]\/[mwfdx]\/[mwfdx]\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Company names without legal forms ("GmbH", "AG", "SE"…), to recognise the same employer. */
export function companyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(gmbh|ag|se|kg|co|mbh|kgaa|ug|ohg|e\.?\s?v|inc|ltd|llc|group|holding)\b\.?/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const deptKey = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const SENT: Stage[] = ['applied', 'interview', 'offer', 'rejected']

/**
 * The card whose CV the recruiters of this company and department have (or will) see: same company, and
 * the same department or one of the two unknown. Each department should get one consistent CV, so a new job
 * there reuses it; motivation letters are still written per job. Cards already sent come first.
 */
export function cvAtCompany(
  apps: Application[],
  company: string,
  department = '',
  excludeId?: string,
): Application | undefined {
  const key = companyKey(company)
  if (!key) return undefined
  const dept = deptKey(department)
  const rank = (a: Application) => (SENT.includes(a.stage) ? 2 : a.stage === 'draft' ? 1 : 0)
  return apps
    .filter((a) => a.id !== excludeId && a.resumeId && companyKey(a.company) === key)
    .filter((a) => !dept || !deptKey(a.department) || deptKey(a.department) === dept)
    .sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0]
}

/**
 * Spoken languages print in one fixed order on every CV: English, German, Arabic, French, Spanish.
 * Names are matched in any CV language (Anglais, Englisch, Inglés, الإنجليزية, ...); others follow in their own order.
 */
const LANGUAGE_ORDER: string[][] = [
  ['engl', 'angl', 'ingl', 'انجليز', 'إنجليز'],
  ['germ', 'allem', 'deutsch', 'alem', 'ألمان', 'المان'],
  ['arab', 'عرب'],
  ['fren', 'fran', 'فرنس'],
  ['span', 'espa', 'castell', 'إسبان', 'اسبان'],
]

function languageRank(name: string): number {
  const n = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const rank = LANGUAGE_ORDER.findIndex((stems) => stems.some((s) => n.includes(s)))
  return rank < 0 ? LANGUAGE_ORDER.length : rank
}

export function orderLanguages(content: ResumeContent): ResumeContent {
  if (!content.sections.some((s) => s.type === 'languages')) return content
  return {
    ...content,
    sections: content.sections.map((s) =>
      s.type === 'languages'
        ? { ...s, items: [...s.items].sort((a, b) => languageRank(a.name) - languageRank(b.name)) }
        : s,
    ),
  }
}

/* -------------------------------- accounts -------------------------------- */

/** Usernames: 2 to 32 lower-case letters, digits, _ and -. They key every row of the account's data. */
export const USERNAME_PATTERN = /^[a-z0-9_-]{2,32}$/
/** Long passwords beat composition rules; 15 is NIST's minimum for a password used on its own (SP 800-63B). */
export const PASSWORD_MIN = 15
const PASSWORD_MAX = 256

export function usernameProblem(username: string): string | null {
  return USERNAME_PATTERN.test(username) ? null : 'A username has 2 to 32 characters: a-z, 0-9, _ and -.'
}

/** Why a new password is refused, or null. The server checks the same rules. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'Leave the username out of the password.'
  if (new Set(password).size < 5) return 'Use more different characters.'
  return null
}
