export const LANGS = ['en', 'fr', 'de'] as const
export type Lang = (typeof LANGS)[number]

export const LANG_LABELS: Record<Lang, { short: string; name: string; flag: string }> = {
  en: { short: 'EN', name: 'English', flag: '🇬🇧' },
  fr: { short: 'FR', name: 'Français', flag: '🇫🇷' },
  de: { short: 'DE', name: 'Deutsch', flag: '🇩🇪' },
}

export const CONTACT_TYPES = ['email', 'phone', 'location', 'website', 'linkedin', 'github', 'other'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]

export interface Contact {
  id: string
  type: ContactType
  value: string
  url: string
}

export interface Personal {
  name: string
  headline: string
  contacts: Contact[]
}

export type SectionType =
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'languages'
  | 'custom'

/** Where a section sits: left/main column, right/side column, or full width. */
export type Placement = 'main' | 'side' | 'full'

interface ItemBase {
  id: string
  hidden?: boolean
}

export interface ExperienceItem extends ItemBase {
  position: string
  company: string
  url: string
  location: string
  start: string
  end: string
  current: boolean
  description: string
}

export interface ProjectItem extends ItemBase {
  name: string
  subtitle: string
  url: string
  start: string
  end: string
  description: string
}

export interface EducationItem extends ItemBase {
  degree: string
  school: string
  url: string
  location: string
  start: string
  end: string
  current: boolean
  description: string
}

export interface SkillItem extends ItemBase {
  name: string
  details: string
  /** 0 = no rating, 1..5 */
  level: number
}

export interface CertificationItem extends ItemBase {
  name: string
  issuer: string
  date: string
  url: string
}

export interface LanguageItem extends ItemBase {
  name: string
  level: string
  /** 0 = no rating, 1..5 */
  rating: number
}

export interface CustomItem extends ItemBase {
  title: string
  subtitle: string
  location: string
  start: string
  end: string
  url: string
  description: string
}

interface SectionBase<T extends SectionType> {
  id: string
  type: T
  title: string
  visible: boolean
  placement: Placement
}

interface SummarySection extends SectionBase<'summary'> {
  text: string
  /** undefined → template decides */
  showTitle?: boolean
}
interface ExperienceSection extends SectionBase<'experience'> {
  items: ExperienceItem[]
}
interface ProjectsSection extends SectionBase<'projects'> {
  items: ProjectItem[]
}
interface EducationSection extends SectionBase<'education'> {
  items: EducationItem[]
}
export interface SkillsSection extends SectionBase<'skills'> {
  items: SkillItem[]
}
interface CertificationsSection extends SectionBase<'certifications'> {
  items: CertificationItem[]
}
interface LanguagesSection extends SectionBase<'languages'> {
  items: LanguageItem[]
}
export interface CustomSection extends SectionBase<'custom'> {
  items: CustomItem[]
}

export type Section =
  | SummarySection
  | ExperienceSection
  | ProjectsSection
  | EducationSection
  | SkillsSection
  | CertificationsSection
  | LanguagesSection
  | CustomSection

export type ItemSection = Exclude<Section, SummarySection>
export type SectionItem = ItemSection['items'][number]

export interface ResumeContent {
  personal: Personal
  sections: Section[]
}

export type TemplateId = 'signature' | 'atlantic' | 'mercury' | 'steady' | 'serif' | 'leaves' | 'executive' | 'latex' | 'scholar'

export interface ResumeStyle {
  accent: string
  text: string
  background: string
  font: string
  headingFont: string
  /** base font size in pt */
  fontSize: number
  /** line-height multiplier */
  lineHeight: number
  /** page margins in mm */
  marginX: number
  marginY: number
  /** px, vertical gap between sections */
  sectionGap: number
  /** px, vertical gap between entries */
  itemGap: number
  /** % width of the main (left) column in two-column layouts */
  columnRatio: number
  showPhoto: boolean
  /** px */
  photoSize: number
  showIcons: boolean
  /** name, headline and contacts: as the template sets them (left) or centred */
  headerAlign?: 'left' | 'center'
}

export interface JobInfo {
  title: string
  company: string
  url: string
  description: string
  /** AI rationale shown to the owner, never rendered on the CV */
  notes: string
  /** overall match (0–100), copied from `score` for list views */
  matchScore: number | null
  analysis?: JobAnalysis | null
  score?: MatchScore | null
  /** company logo (asset URL) */
  logo?: string
  location?: string
}

/* ------------------------------ job matching ------------------------------ */

export const REQ_CATEGORIES = ['skills', 'experience', 'seniority', 'education', 'languages', 'location'] as const
export type ReqCategory = (typeof REQ_CATEGORIES)[number]

export interface JobRequirement {
  id: string
  /** short English phrase */
  text: string
  /** exact words of the posting that state it */
  quote: string
  category: ReqCategory
  importance: 'must' | 'nice'
  /** a hard filter: applications without it are usually rejected */
  knockout: boolean
}

export interface JobKeyword {
  /** term as written in the posting */
  term: string
  /** accepted variants (synonyms, translations, spellings) */
  alts: string[]
}

/** What a posting asks for, extracted once per job and reused for every score. */
export interface JobAnalysis {
  title: string
  company: string
  location: string
  workMode: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  seniority: 'intern' | 'student' | 'junior' | 'mid' | 'senior' | 'lead' | 'unknown'
  yearsRequired: number | null
  /** ISO 639-1 code of the posting language */
  language: string
  summary: string
  requirements: JobRequirement[]
  keywords: JobKeyword[]
  model: string
  at: string
}

export type Verdict = 'met' | 'partial' | 'missing' | 'unknown'

export interface RequirementResult {
  id: string
  verdict: Verdict
  /** exact words of the CV that support the verdict */
  evidence: string
  /** ≤ 12 words */
  reason: string
}

export const SCORE_DIMENSIONS = ['skills', 'experience', 'seniority', 'education', 'languages', 'location', 'keywords'] as const
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

export interface MatchScore {
  overall: number
  /** null = the posting says nothing about it */
  dimensions: Record<ScoreDimension, number | null>
  /** set when a missing hard requirement limits the overall score */
  cap: { value: number; reason: string } | null
  requirements: RequirementResult[]
  keywords: { term: string; found: boolean }[]
  /** CV language that was scored */
  lang: Lang
  /** contentHash of that CV version when scored */
  contentHash: string
  model: string
  at: string
}

interface TranslationMeta {
  sourceHash: string
  at: string
}

export interface Resume {
  id: string
  name: string
  kind: 'master' | 'tailored'
  baseId: string | null
  isMain: boolean
  template: TemplateId
  style: ResumeStyle
  photo: string
  sourceLang: Lang
  content: Partial<Record<Lang, ResumeContent>>
  translations: Partial<Record<Lang, TranslationMeta>>
  job: JobInfo | null
  createdAt: string
  updatedAt: string
}

/** Row count and latest change of each area of an account; a different stamp means that area changed. */
export interface ChangeStamps {
  resumes: string
  applications: string
  settings: string
}

/** One account as the admin sees it (Account dialog). */
export interface AccountInfo {
  username: string
  /** "secret": from the AUTH_USERS secret; "app": made in the app (first-run setup or an invitation) */
  source: 'secret' | 'app'
  disabled: boolean
  admin: boolean
}

/** A pending invitation; its code is shown once and never stored, only its hash (the id). */
export interface InviteInfo {
  id: string
  createdBy: string
  createdAt: string
  /** Unix seconds */
  expiresAt: number
}

export interface ResumeMeta {
  id: string
  name: string
  kind: Resume['kind']
  baseId: string | null
  isMain: boolean
  template: TemplateId
  photo: string
  langs: Lang[]
  sourceLang: Lang
  job: Pick<JobInfo, 'title' | 'company' | 'matchScore' | 'logo'> | null
  createdAt: string
  updatedAt: string
}

/** Extra material the AI can pick from when tailoring a CV. */
export interface Library {
  projects: ProjectItem[]
  skills: SkillItem[]
  experience: ExperienceItem[]
  certifications: CertificationItem[]
  /** Free-form facts: extra achievements, metrics, tools, context. */
  notes: string
}

export interface AiStatus {
  provider: 'anthropic' | 'openai' | 'workers-ai' | 'none'
  model: string
  /** paid models only */
  spend?: AiSpend | null
  /** AI-text detector available on the server ("AI or Not"), null when no API key is set */
  detector?: string | null
}

/** US dollars spent on paid AI calls, and the caps. */
export interface AiSpend {
  today: number
  month: number
  dailyLimit: number
  monthlyLimit: number
}

/** A job posting read from a link. */
export interface ScrapedJob {
  url: string
  title: string
  company: string
  location: string
  description: string
  /** company logo (asset URL), '' when none was found */
  logo: string
  /** how the page was read */
  source: string
}

/* ------------------------------ applications ------------------------------ */

export const STAGES = ['saved', 'draft', 'applied', 'interview', 'offer', 'rejected'] as const
export type BuiltinStage = (typeof STAGES)[number]
/** A column the user added: "col_<built-in stage it follows>_<random>", so its place and meaning are known from the id. */
type CustomStage = `col_${BuiltinStage}_${string}`
export type Stage = BuiltinStage | CustomStage

/** A column the user added to the board, shown right after its built-in stage. */
export interface BoardColumn {
  id: CustomStage
  label: string
}

export const STAGE_LABELS: Record<BuiltinStage, string> = {
  saved: 'Saved',
  draft: 'Draft',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
}

/** A job application tracked on the board. */
export interface Application {
  id: string
  stage: Stage
  /** position inside its column, ascending */
  order: number
  title: string
  company: string
  /** company logo (asset URL) */
  logo: string
  url: string
  location: string
  salary: string
  /** the CV sent, or to send */
  resumeId: string | null
  /** language version of that CV */
  lang: Lang | null
  /** YYYY-MM-DD */
  appliedOn: string
  /** e.g. "Call with HR" */
  nextStep: string
  /** YYYY-MM-DD */
  nextDate: string
  /** recruiter or hiring manager */
  contact: string
  notes: string
  description: string
  /** where the job was found / the application was sent: "LinkedIn", "Indeed", "Company career page"… */
  source?: string
  /** direct application link (company career page, ATS form or mailto:), when it differs from the posting */
  applyUrl?: string
  /** published e-mail of the contact person or HR team */
  contactEmail?: string
  /** German the posting asks for: "C1", "fluent", "nice to have", "not required"… */
  german?: string
  /** team or department, when the posting names one */
  department?: string
  /** "Working student · 20 h/week", "Internship · 6 months", "Full-time"… */
  employment?: string
  /** "On-site", "Hybrid", "Remote" */
  workMode?: string
  /** application deadline, YYYY-MM-DD */
  deadline?: string
  /** when the posting was first published, YYYY-MM-DD */
  postedOn?: string
  /** how well the job fits the profile (Claude's or the user's estimate) */
  fit?: ApplicationFit | null
  /** AI-detector results of the CV and letters, oldest first */
  aiChecks?: AiCheck[]
  /** motivation letters, one per language */
  letters?: Partial<Record<Lang, CoverLetter>>
  /** what the user changed of the letters' look; the rest follows the linked CV */
  letterStyle?: Partial<LetterStyle>
  /** answers to the questions of the online application form, in the form's order, ready to copy */
  formAnswers?: FormAnswer[]
  /** stage changes, oldest first */
  history: { stage: Stage; at: string }[]
  createdAt: string
  updatedAt: string
}

interface ApplicationFit {
  /** 0–100, null when not estimated */
  score: number | null
  /** why it fits, and the gaps */
  summary: string
}

/** One question of an application form and the answer to paste (or the option to pick). */
export interface FormAnswer {
  question: string
  /** text to paste, or for a choice question the option to pick; empty when only the user can answer */
  answer: string
  /** what the user has to decide or check, e.g. "Your choice: pick the band you want" */
  note?: string
}

/** One run of an AI-text detector on a document of an application. */
export interface AiCheck {
  doc: 'cv' | 'letter'
  lang: Lang
  /** "GPTZero", "ZeroGPT", "AI or Not"… */
  tool: string
  /** share of the text the detector rates as AI-written, 0–100 */
  aiPercent: number
  at: string
  note?: string
}

/** A motivation letter. Sender details and style come from the CV it goes with. */
export interface CoverLetter {
  /** "Application for the Working Student Data Engineering position" */
  subject: string
  /** address block, one line per row */
  recipient: string
  /** salutation, paragraphs (blank line between them) and closing formula; the name is added below */
  body: string
  /** YYYY-MM-DD printed with the place */
  date: string
  /** fact-check warnings and writing notes, never printed */
  notes: string
  /** the letter template; unset = DIN 5008 for German letters, modern otherwise (letterLayoutOf) */
  layout?: LetterLayout
  /** what is attached, comma- or line-separated, printed under "Anlagen" / "Enclosures" */
  enclosures?: string
  updatedAt: string
}

/** The letter templates. din5008: the German business-letter standard (window-envelope address field, fold marks). */
export const LETTER_LAYOUTS = ['din5008', 'modern', 'classic', 'banner', 'sidebar'] as const
export type LetterLayout = (typeof LETTER_LAYOUTS)[number]
export const LETTER_LAYOUT_LABELS: Record<LetterLayout, string> = { din5008: 'DIN 5008', modern: 'Modern', classic: 'Classic', banner: 'Banner', sidebar: 'Sidebar' }
export const LETTER_LAYOUT_DESCRIPTIONS: Record<LetterLayout, string> = {
  din5008: 'The German business-letter standard, with the address where a window envelope shows it.',
  modern: 'Name and contacts as a header over a coloured rule, like the CV.',
  classic: 'Centred name and contacts between thin rules, quiet and formal.',
  banner: 'Name and role on a full-width band in the accent colour.',
  sidebar: 'Name, contacts and date in a tinted column beside the letter.',
}

/**
 * A letter's own look, chosen in its Design panel and shared by the card's letters in every language. Each
 * field left out follows the linked CV (letterStyleOf), so a letter matches its CV until the user changes it.
 */
export interface LetterStyle {
  font: string
  /** "" uses the text font */
  headingFont: string
  accent: string
  text: string
  background: string
  /** body text, pt */
  fontSize: number
  lineHeight: number
  /** mm; DIN 5008 keeps the margins the standard sets */
  marginX: number
  marginY: number
  /** space between paragraphs, in lines */
  paragraphGap: number
}

/** NDJSON events streamed by the AI endpoints. */
export type AiEvent =
  | { type: 'progress'; message: string }
  | { type: 'ping' }
  | { type: 'done'; resume: Resume }
  | { type: 'result'; result: unknown }
  | { type: 'error'; message: string }

/* ------------------------------ job search ------------------------------ */

export const JOB_TYPES = ['working_student', 'student_assistant', 'internship', 'thesis', 'part_time', 'full_time', 'trainee'] as const
export type JobType = (typeof JOB_TYPES)[number]

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  working_student: 'Working student (Werkstudent)',
  student_assistant: 'Student assistant (HiWi)',
  internship: 'Internship (Praktikum)',
  thesis: 'Thesis (Abschlussarbeit)',
  part_time: 'Part-time',
  full_time: 'Full-time',
  trainee: 'Trainee / graduate programme',
}

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const
type WorkMode = (typeof WORK_MODES)[number]

/** The highest German requirement worth applying to. */
export const GERMAN_LIMITS = ['none', 'basic', 'B1', 'B2', 'C1', 'any'] as const
export type GermanLimit = (typeof GERMAN_LIMITS)[number]

export const GERMAN_LIMIT_LABELS: Record<GermanLimit, string> = {
  none: 'No German required (English is the working language)',
  basic: 'German nice to have, or basic (A1–A2)',
  B1: 'Up to B1',
  B2: 'Up to B2',
  C1: 'Up to C1 (fluent)',
  any: 'Any level',
}

/** Languages to prepare the CV and letter in. */
export const DOC_LANGS = ['posting', 'posting+en', 'en', 'all'] as const
export type DocLangs = (typeof DOC_LANGS)[number]

export const DOC_LANG_LABELS: Record<DocLangs, string> = {
  posting: "The posting's language",
  'posting+en': "The posting's language, plus English",
  en: 'Always English',
  all: 'English, German and French',
}

/** What the user is looking for: read by Claude (MCP) and used to build the job-search prompts. */
export interface SearchProfile {
  /** target roles, fields and keywords */
  roles: string
  /** country of the job search; empty = Germany (German-level rules and the Bundesagentur search apply only there) */
  country: string
  /** cities and regions, remote preferences */
  locations: string
  radiusKm: number
  jobTypes: JobType[]
  workModes: WorkMode[]
  /** the user's own German level */
  germanLevel: string
  germanLimit: GermanLimit
  /** hours per week, semester / holiday availability */
  availability: string
  /** earliest start */
  start: string
  salary: string
  /** residence / work permit facts that limit the search */
  workPermit: string
  /** preferred industries and companies */
  targets: string
  /** job sites to search first, one per line: name, link, what for */
  sites: string
  /** deal-breakers: industries, companies, tasks to skip */
  avoid: string
  docLangs: DocLangs
  /** highest AI-detector score accepted for a document, in % */
  maxAiPercent: number
  /** drafts to prepare per search run */
  perRun: number
  /** lowest fit (0–100) worth a draft */
  minFit: number
  /** anything else Claude should know */
  notes: string
  /** the user's own rules for their CVs and letters, on top of CV_RULES */
  cvRules: string
  /** contact lines the letters leave out (the CVs keep them), e.g. ['github'] */
  letterHideContacts: ContactType[]
  updatedAt?: string
}
