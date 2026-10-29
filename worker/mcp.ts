import type { Context } from 'hono'
import type { AiCheck, Application, BoardColumn, ContactType, CoverLetter, Lang, LetterLayout, LetterStyle, Library, Resume, ResumeContent, ResumeStyle, SectionItem, SectionType, Stage } from '@shared/types'
import { LANG_LABELS, LANGS, LETTER_LAYOUT_DESCRIPTIONS, LETTER_LAYOUTS, STAGES } from '@shared/types'
import { CLAUDE_PROMPTS, type PromptContext } from '@shared/prompts'
import { FONTS, TEMPLATE_MAP, TEMPLATES } from '@shared/templates'
import {
  applyTemplatePlacement,
  availableLangs,
  boardStages,
  cityOf,
  cleanLetterStyle,
  cleanSearchProfile,
  companyKey,
  contentHash,
  cvAtCompany,
  cvMarkdown,
  ENCLOSURES,
  isItemSection,
  isSentStage,
  isStage,
  isUnsent,
  itemHead,
  jobSource,
  jobUrlKey,
  LETTER_STYLE_LIMITS,
  letterLayoutOf,
  newApplication,
  newItem,
  newSection,
  profileFacts,
  searchesGermany,
  stageLabel,
  titleKey,
  toMeta,
  uid,
} from '@shared/utils'
import { AiError, aiStatus, list, text, translatableFields, translationProblem } from './ai'
import { connectorUser, signShare, siteOrigin } from './auth'
import { aiSpend } from './budget'
import * as db from './db'
import { detectAi, detectorName } from './detect'
import { findOnBa, searchBa } from './jobsearch'
import { fullNameSalutation, gapSentences, letterIssues, letterRules } from './letter'
import { findLogo } from './logo'
import { formAnswersField, readApplicationForm } from './forms'
import { checkLayout, checkLetterFit, fitLayout, type FitReport } from './pdf'
import { linkedInJobId, readJobPage, type JobPage } from './scrape'
import {
  addAiCheck,
  createTailoredCv,
  documentText,
  letterCv,
  letterForApplication,
  masterResume,
  rescore,
  saveLetter,
  translateInto,
  type TailorJob,
} from './service'
import { corpusOf, systemPrompt, TAILOR_SCHEMA, tailoringMaterial, type TailorOutput } from './tailor'

/**
 * MCP server (Streamable HTTP, stateless JSON responses) so an agent such as Claude Desktop can run the job
 * search end to end: find postings, write the tailored CV and motivation letter (itself, through the same fact
 * checks, or with the app's model), check them with an AI-text detector, and leave complete "Draft" cards on the
 * applications board for the user to send. Each account has its own connector token (auth.ts connectorToken),
 * and every tool acts in that account only.
 */

type Ctx = Context<{ Bindings: Env }>
type Json = Record<string, unknown>

const PROTOCOL = '2025-06-18'

const INSTRUCTIONS = `Sforza, the user's resume builder: their CVs (EN/FR/DE), a knowledge base (library) of extra projects, skills and facts, a job-search profile, and an applications board (kanban: Saved → Draft → Applied → Interview → Offer → Rejected, plus any columns the user added).

Job-search workflow (the prompts "job_hunt" and "draft_application" of this connector spell it out). When the user just pastes a job link (LinkedIn or any other), that means: prepare a complete draft for it, as in "draft_application": read it, check_jobs, judge the fit, then CV, letter, AI check, card fields and the application form's answers, all left in "Draft"; never apply.
1. get_profile once per session: CV, knowledge base, search profile (country, roles, places, German limit, document languages, AI-detector target) and board. Each account is a different person: use only this account's profile, CV and board, never another user's places or rules. If it returns cv_setup_needed, build the master CV with the user first. If it returns setup_needed, ask the user those questions and save_search_profile before any search. A thin knowledge base (few projects or skills) limits what a CV can say: offer to fill it (the prompt "build_knowledge_base": GitHub, courses, achievements) with update_library.
2. Find postings in the profile's country and places (country empty = Germany). Germany: search_jobs (Bundesagentur für Arbeit) and, in the browser, LinkedIn, Indeed, StepStone and company career pages. Any other country: search_jobs does not cover it; use web search and the browser on that country's boards (e.g. UK: LinkedIn, Indeed UK, Reed, Totaljobs, CV-Library, the university's careers service) and company career pages. Rule: only postings first published in the last 7 days; check each posting's date and skip older ones (also old ads reposted or re-dated). check_jobs drops the ones already on the board.
3. Read each posting (read_job_posting, or the text in the browser when a site blocks it) and judge the fit honestly against the search profile, above all the language requirement against the user's languages (in Germany: the German requirement against their German level and germanLimit). Skip poor fits and say why.
4. Tailored CV: get_tailoring_material, write it yourself, save_tailored_cv with the card fields (new cards go to "Draft"). Other languages: get_cv + save_cv_translation.
   Its rules hold the common-sense rules every CV follows (adapt it to the posting, only facts from the CV and knowledge base, titles and dates as stated, one full page) and this user's own rules for CVs and letters (search profile cvRules, also in get_letter_rules). Follow both; when the user states a lasting preference for their CVs or letters, add it to cvRules with save_search_profile.
   Layout rule for every tailored CV: exactly one page, completely filled: every section whole, no empty space at the bottom of the page or under a column. Too long: hide the least relevant bullets, projects or skill groups (edit_cv) and keep everything the posting asks for. Spacing, font size and column width: never by hand, run fit_cv_to_page, which sets them for the fullest single page. Still too short after it, or a column that ends early: add a relevant bullet or project, or move a section to the other column, then fit_cv_to_page again. A tailored CV is ready only when its layout says "ok": true; only the master CV may have two pages. save_tailored_cv, edit_cv and check_cv_layout return "layout"; after every content change run fit_cv_to_page, then fix what it still lists until "ok" is true. Check translations too (they run longer). For style and layout (font size, spacing, columns, full-width sections), hiding or editing single items, or any change to an existing CV, the master CV included, use edit_cv: it keeps the translations. A new tailored CV takes the master CV's design (template, colours, fonts, section placement); when the user restyles the master and wants older CVs to follow, edit_cv design_from "master" on each unsent one, then fit_cv_to_page. A new card that duplicates one already on the board: delete_application. A tailored CV no card uses: delete_cv.
   One CV per company department: recruiters of a department see every application, so they must all carry the same CV. When check_jobs reports cv_at_company (same company, same or unknown department), do not tailor a new CV: create the card with save_application (resume_id of that CV, stage "draft", the card fields). A separate CV only for a clearly different department (save_tailored_cv with card.department and separate_cv: true).
5. Motivation letter, always a new one per job, also at the same company: get_letter_rules, write it yourself, save_motivation_letter per language; fix the warnings. Every letter fits on one page: when its "layout" is not ok, shorten it and save it again.
6. AI check: check_ai_text when the server has a detector, else in the browser: GPTZero on drafts, then Pangram once on the final version (never ZeroGPT). Above the profile's target: at most ONE rewrite, in natural full sentences (never fragments or choppy one-liners), same facts; then re-read the rewrite for style before saving it: it must still sound like the user and read well (no stiff or odd wording, no filler, no broken rhythm, no lost specifics); fix any such line by hand, which does not count as a second rewrite; then keep it even if the score stays high: detectors are unreliable and a well-written letter matters more; record_ai_check for every browser result.
7. Complete the card with save_application: apply_url, contact and e-mail (only when published in the posting or on the company's site, never guessed), German required, employment, work mode, deadline, posted_on (the date the posting was first published, when known), fit.
   Application form, for EVERY card: follow the posting's Apply / Bewerben button to the real application form (the company or ATS page, not LinkedIn Easy Apply or a job board) and save that page as apply_url; an e-mail application gets apply_url "mailto:<published address>". LinkedIn links: read_job_posting says where Apply leads (apply_on) and may find the same job on the Arbeitsagentur board with the company's posting (same_job_elsewhere); read_application_form with the LinkedIn link follows it when it can, else its "next" says how to find the company form. Then read_application_form(apply_url): it reads Greenhouse directly and any other public form by opening it and clicking Apply when needed. If it finds no fields or says the form needs an account, open the form in your browser and read the fields there. Save the questions with save_form_answers so the user can copy each answer: on a "saved" card with empty answers, when preparing documents with the answers (questions only the user can answer get a note).
   Last, check_draft: it renders the CV in every language and every letter. A draft is done only when it says "ready": true (each CV one full page with no empty space at the bottom or under a column, each letter one page); fix what it lists and run it again before telling the user the draft is ready.
8. Never submit an application, fill in an application form or send an e-mail unless the user explicitly asks for that specific job. Once the user has sent it: save_application with stage "applied", applied_on and source.

Rules: never invent experience, skills, numbers, availability, salary or work-permit facts; everything comes from the CV, the knowledge base and the search profile. Never point out a missing skill or tool in a letter, a CV or a form answer ("I have not used X yet"): leave it out and mention it only in the notes. No em dashes (—) in a CV, letter or form answer, in any language: write a comma, a colon or a new sentence (the server turns any left into commas). Tools ending in _with_site_ai and score_cv use the site's paid model and stop at the user's budget; prefer doing the writing yourself.`

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v)
const str = (v: unknown, max = 60_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

class ToolError extends Error {}

/** design_letter's style fields and the LetterStyle field each sets. */
const LETTER_STYLE_NAMES = {
  font: 'font',
  heading_font: 'headingFont',
  accent: 'accent',
  text: 'text',
  background: 'background',
  font_size: 'fontSize',
  line_height: 'lineHeight',
  margin_x: 'marginX',
  margin_y: 'marginY',
  paragraph_gap: 'paragraphGap',
} as const satisfies Record<string, keyof LetterStyle>

/** A card's own letter style in design_letter's names; {} means every letter follows the linked CV. */
const letterStyleView = (style: Partial<LetterStyle> | undefined) =>
  Object.fromEntries(Object.entries(LETTER_STYLE_NAMES).flatMap(([k, field]) => (style?.[field] !== undefined ? [[k, style[field]]] : [])))

function needLang(v: unknown, label = 'lang'): Lang {
  if (!isLang(v)) throw new ToolError(`${label} must be one of ${LANGS.join(', ')}`)
  return v
}

function needDoc(v: unknown): AiCheck['doc'] {
  if (v !== 'cv' && v !== 'letter') throw new ToolError('doc must be "cv" or "letter"')
  return v
}

async function needResume(env: Env, id: unknown): Promise<Resume> {
  let resume = typeof id === 'string' ? await db.getResume(env, id) : null
  // "master" works on every account: newer accounts store their master CV under a generated id.
  if (!resume && id === 'master') resume = await masterResume(env).catch(() => null)
  if (!resume) throw new ToolError(`CV "${String(id)}" not found. get_profile lists the CVs.`)
  return resume
}

/** A tailored CV stays as it was sent with an application. */
async function refuseSent(env: Env, resume: Resume): Promise<void> {
  if (resume.kind === 'master') return
  const sent = (await db.listApplications(env)).find((a) => a.resumeId === resume.id && !isUnsent(a.stage))
  if (sent) throw new ToolError(`This CV was already sent ("${sent.title}" is ${stageLabel(sent.stage)}); save a new CV with save_tailored_cv instead of changing it.`)
}

const FULL_WIDTH_TYPES = ['languages', 'education', 'projects', 'skills', 'certifications', 'custom'] as const
const SECTION_TYPES: SectionType[] = ['summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'languages', 'custom']

/** edit_cv style fields: argument, ResumeStyle key and the range kept within resume standards (9 pt is the smallest readable body size). */
const STYLE_LIMITS: [string, keyof ResumeStyle, number, number][] = [
  ['font_size', 'fontSize', 9, 12],
  ['line_height', 'lineHeight', 1.05, 1.6],
  ['margin_x', 'marginX', 6, 25],
  ['margin_y', 'marginY', 6, 25],
  ['section_gap', 'sectionGap', 4, 30],
  ['item_gap', 'itemGap', 2, 24],
  ['column_ratio', 'columnRatio', 35, 70],
  ['photo_size', 'photoSize', 50, 170],
]

/** A CV's style in edit_cv's names. */
const styleView = (st: ResumeStyle) => ({
  ...Object.fromEntries(STYLE_LIMITS.map(([name, key]) => [name, st[key]])),
  show_photo: st.showPhoto,
  show_icons: st.showIcons,
  header_align: st.headerAlign ?? 'left',
  font: st.font,
  heading_font: st.headingFont,
  accent: st.accent,
  text: st.text,
  background: st.background,
})

/** What fit_cv_to_page may change, by its edit_cv name. */
const FIT_KEYS = ['fontSize', 'lineHeight', 'sectionGap', 'itemGap', 'marginY', 'columnRatio'] as const
const fitStyle = (style: ResumeStyle) =>
  Object.fromEntries(STYLE_LIMITS.filter(([, key]) => (FIT_KEYS as readonly string[]).includes(key)).map(([name, key]) => [name, style[key]]))

/** Item fields that are not text: edit_cv sets them in every language. */
const SHARED_FIELDS = ['start', 'end', 'current', 'url', 'level', 'date']

/** Sets the given fields that the item has (strings, or the skill level as a number); returns the names it does not have. */
function setItemFields(item: SectionItem, fields: Json): string[] {
  const target = item as unknown as Record<string, unknown>
  const unknown: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id' || k === 'hidden' || !(k in target)) unknown.push(k)
    else if (typeof target[k] === 'boolean' && typeof v === 'boolean') target[k] = v
    else if (typeof target[k] === 'number' && typeof v === 'number') target[k] = Math.max(0, Math.min(5, Math.round(v)))
    else if (typeof target[k] === 'string' && typeof v === 'string') target[k] = k === 'description' ? str(v, 5000).replace(/\r\n/g, '\n') : str(v, 1000)
    else unknown.push(k)
  }
  return unknown
}

const LAYOUT_FIX =
  'Layout rule for a tailored CV: exactly one page, completely filled: every section whole, no empty space at the bottom of the page or under a column. Too long: hide the least relevant bullets, projects or skill groups (edit_cv) and keep everything the posting asks for. Spacing, font size and column width: never by hand, run fit_cv_to_page, which sets them for the fullest single page. Still too short after it, or a column that ends early: add a relevant bullet or project, or move a section to the other column, then fit_cv_to_page again. A tailored CV is ready only when its layout says "ok": true; only the master CV may have two pages. A section alone in a column with the other half of the page white goes full width (edit_cv sections placement "full"). Use edit_cv for content and placement (it keeps the translations), then fit_cv_to_page.'

/** The rendered CV's page layout as advice for the agent: whole sections on each page, no gap at a page bottom. */
async function layoutOf(env: Env, origin: string, resume: Resume, lang: Lang) {
  try {
    const l = await checkLayout(env as Env & db.Store, origin, resume, lang)
    // A tailored CV is one full page; only the master CV (the source of everything) may run longer.
    const onePage = resume.kind !== 'master'
    const problems = [
      ...(onePage && l.pages > 1 ? [`${l.pages} pages: a tailored CV must fit on one page`] : []),
      ...l.split.map((t) => `"${t}" runs over a page break`),
      ...l.gaps.map(
        (g) =>
          `${g.mm} mm empty at the bottom of page ${g.page}${g.column === 'page' ? '' : ` under the ${g.column} column`}${g.before ? `, before "${g.before.slice(0, 50)}"` : ': fill it (relevant bullet or project, or a little more spacing)'}`,
      ),
      ...(l.lonely ?? []).map(
        (s) =>
          `${s.sections.map((t) => `"${t}"`).join(', ')} sits alone in the side column on page ${s.page}, with the other half of the page empty: make it full width (edit_cv sections ${JSON.stringify((s.types.length ? s.types : ['languages']).map((type) => ({ type, placement: 'full' })))}) or shorten the side column`,
      ),
    ]
    return {
      checked: true,
      pages: l.pages,
      fill_percent: l.lastPageFill,
      ok: problems.length === 0,
      problems,
      next: problems.length ? LAYOUT_FIX : l.pages === 1 ? 'Good layout: one full page. Nothing to do.' : 'Whole sections, no gaps.',
    }
  } catch (err) {
    return { checked: false, error: (err as Error).message, next: 'Layout check unavailable; ask the user to look at the PDF.' }
  }
}

const LETTER_FIX =
  'Layout rule for a motivation letter: one page. Shorten it (drop a sentence or tighten a paragraph, staying within 220–320 words; a long address block or enclosures list costs lines too) and save it again with save_motivation_letter. A letter is ready only when its layout says "ok": true.'

/** Whether the rendered letter fits on one page. */
async function letterFitOf(env: Env, origin: string, app: Application, lang: Lang) {
  try {
    const l = await checkLetterFit(env as Env & db.Store, origin, app, await letterCv(env, app), lang)
    const problems = l.pages > 1 ? [`${l.pages} pages: the letter runs about ${Math.max(1, l.overMm)} mm past one page`] : []
    return { checked: true, pages: l.pages, ok: !problems.length, problems, next: problems.length ? LETTER_FIX : 'Good layout: one page. Nothing to do.' }
  } catch (err) {
    return { checked: false, error: (err as Error).message, next: 'Layout check unavailable; ask the user to look at the PDF.' }
  }
}

async function needApplication(env: Env, id: unknown): Promise<Application> {
  const app = typeof id === 'string' ? await db.getApplication(env, id) : null
  if (!app) throw new ToolError(`Application "${String(id)}" not found. list_applications lists them.`)
  return app
}

function jobArg(v: unknown): TailorJob {
  const j = (v ?? {}) as Json
  const job = {
    title: str(j.title, 300),
    company: str(j.company, 300),
    url: str(j.url, 2000),
    description: str(j.description),
    location: str(j.location, 300),
    logo: str(j.logo, 300),
  }
  if (!job.title) throw new ToolError('job.title is required')
  return job
}

/** Latest detector result per document and language: "letter DE 7% (GPTZero)". */
function latestChecks(a: Application): string[] {
  const latest = new Map<string, AiCheck>()
  for (const c of a.aiChecks ?? []) latest.set(`${c.doc}:${c.lang}`, c)
  return [...latest.values()].map((c) => `${c.doc} ${c.lang.toUpperCase()} ${c.aiPercent}% (${c.tool})`)
}

function applicationSummary(a: Application, origin: string, columns: BoardColumn[] = []) {
  return {
    id: a.id,
    stage: a.stage,
    stage_label: stageLabel(a.stage, columns),
    title: a.title,
    company: a.company,
    location: a.location,
    url: a.url,
    apply_url: a.applyUrl ?? '',
    source: a.source ?? '',
    department: a.department ?? '',
    employment: a.employment ?? '',
    work_mode: a.workMode ?? '',
    german: a.german ?? '',
    deadline: a.deadline ?? '',
    posted_on: a.postedOn ?? '',
    salary: a.salary,
    contact: a.contact,
    contact_email: a.contactEmail ?? '',
    fit: a.fit ?? null,
    applied_on: a.appliedOn,
    resume_id: a.resumeId,
    cv_language: a.lang,
    letters: Object.keys(a.letters ?? {}),
    ai_checks: latestChecks(a),
    form_answers: a.formAnswers?.length ?? 0,
    next_step: [a.nextStep, a.nextDate].filter(Boolean).join(' · '),
    notes: a.notes.slice(0, 500),
    edit_url: `${origin}/edit/applications/${a.id}`,
    cv_edit_url: a.resumeId ? `${origin}/edit/cv/${a.resumeId}` : null,
  }
}

const STAGE_HELP = `${STAGES.join(', ')}, or the id of a column the user added (get_profile board_columns; it counts as the stage named in its id)`

async function links(env: Env, origin: string, kind: 'cv' | 'letter', id: string, lang: Lang) {
  return `${origin}/api/share/${kind}/${encodeURIComponent(id)}?lang=${lang}&t=${encodeURIComponent(await signShare(env, db.ownerOf(env), kind, id, lang))}`
}

function enterStage(app: Application, stage: Stage, appliedOn?: string) {
  if (app.stage !== stage) {
    app.stage = stage
    app.history = [...(app.history ?? []), { stage, at: new Date().toISOString() }]
    app.order = -Date.now()
  }
  if (appliedOn) app.appliedOn = appliedOn
  else if (isSentStage(stage) && !app.appliedOn) app.appliedOn = new Date().toISOString().slice(0, 10)
}

/** Card details shared by save_application and save_tailored_cv. */
const cardSchema = {
  apply_url: {
    type: 'string',
    description: 'the application form itself: the page the posting\'s Apply button opens (company or ATS form, not a job board or LinkedIn Easy Apply), or mailto:<published address>',
  },
  source: { type: 'string', description: 'where the job was found / will be sent: LinkedIn, Indeed, StepStone, Company career page…; detected from the url when omitted' },
  location: { type: 'string' },
  department: { type: 'string', description: 'team or department named in the posting (decides whether a CV at the same company can be reused)' },
  employment: { type: 'string', description: 'e.g. "Working student · 20 h/week", "Internship · 6 months"' },
  work_mode: { type: 'string', description: 'On-site, Hybrid or Remote' },
  german: { type: 'string', description: 'German the posting asks for, as stated: "C1", "fluent", "good (B2)", "nice to have", "not required"' },
  deadline: { type: 'string', description: 'application deadline, YYYY-MM-DD' },
  posted_on: { type: 'string', description: 'when the posting was first published, YYYY-MM-DD (from the posting or the job board; "3 days ago" counts back from today); only when known' },
  salary: { type: 'string' },
  contact: { type: 'string', description: 'contact person and role, and where it was found' },
  contact_email: { type: 'string', description: 'only an address published in the posting or on the company site; never guessed' },
  fit_score: { type: 'number', description: 'your fit estimate 0–100' },
  fit_summary: { type: 'string', description: '2–3 sentences: strengths and gaps' },
  next_step: { type: 'string' },
  next_date: { type: 'string', description: 'YYYY-MM-DD' },
  notes: { type: 'string', description: 'replaces the notes; read them first (get_application) to append' },
  description: { type: 'string', description: 'job text, kept in case the posting goes offline' },
}

function applyCardFields(app: Application, args: Json) {
  const text = (key: 'location' | 'salary' | 'contact' | 'notes' | 'description', arg: string) => {
    if (typeof args[arg] === 'string') app[key] = str(args[arg])
  }
  const opt = (key: 'applyUrl' | 'contactEmail' | 'german' | 'employment' | 'workMode' | 'department', arg: string, max = 2000) => {
    if (typeof args[arg] === 'string') app[key] = str(args[arg], max)
  }
  text('location', 'location')
  text('salary', 'salary')
  text('contact', 'contact')
  text('notes', 'notes')
  text('description', 'description')
  opt('applyUrl', 'apply_url')
  opt('contactEmail', 'contact_email', 300)
  opt('german', 'german', 200)
  opt('employment', 'employment', 300)
  opt('workMode', 'work_mode', 100)
  opt('department', 'department', 300)
  if (isDate(args.deadline) || args.deadline === '') app.deadline = str(args.deadline, 10)
  if (isDate(args.posted_on) || args.posted_on === '') app.postedOn = str(args.posted_on, 10)
  if (typeof args.next_step === 'string') app.nextStep = str(args.next_step)
  if (isDate(args.next_date) || args.next_date === '') app.nextDate = str(args.next_date, 10)
  if (typeof args.source === 'string') app.source = str(args.source, 200)
  else if (!app.source && app.url) app.source = jobSource(app.url)
  if (typeof args.fit_score === 'number' || typeof args.fit_summary === 'string') {
    const score = typeof args.fit_score === 'number' && Number.isFinite(args.fit_score) ? Math.min(100, Math.max(0, Math.round(args.fit_score))) : (app.fit?.score ?? null)
    app.fit = { score, summary: typeof args.fit_summary === 'string' ? str(args.fit_summary, 2000) : (app.fit?.summary ?? '') }
  }
}

/** Looks up the company logo from the posting or the direct application link. */
async function fillLogo(env: Env, app: Application) {
  for (const url of [app.url, app.applyUrl]) {
    if (app.logo || !url || url.startsWith('mailto:')) continue
    app.logo = await findLogo(env, url)
  }
}

function findOnBoard(apps: Application[], job: { url?: string; title?: string; company?: string }): Application | undefined {
  const key = job.url ? jobUrlKey(job.url) : ''
  if (key) {
    const byUrl = apps.find((a) => [a.url, a.applyUrl].some((u) => u && jobUrlKey(u) === key))
    if (byUrl) return byUrl
  }
  const title = titleKey(job.title ?? '')
  const company = companyKey(job.company ?? '')
  if (!title || !company) return undefined
  return apps.find((a) => titleKey(a.title) === title && companyKey(a.company) === company)
}

type LibraryList = 'projects' | 'skills' | 'experience' | 'certifications'
const LIBRARY_LISTS: LibraryList[] = ['projects', 'skills', 'experience', 'certifications']
const LIBRARY_FIELDS: Record<LibraryList, string[]> = {
  projects: ['name', 'subtitle', 'url', 'start', 'end', 'description'],
  skills: ['name', 'details'],
  experience: ['position', 'company', 'url', 'location', 'start', 'end', 'description'],
  certifications: ['name', 'issuer', 'date', 'url'],
}

function setLibraryFields(item: Record<string, unknown>, list: LibraryList, fields: Json) {
  for (const key of LIBRARY_FIELDS[list]) if (typeof fields[key] === 'string') item[key] = str(fields[key], 8000)
  if (list === 'experience' && typeof fields.current === 'boolean') item.current = fields.current
}

const libraryText = (lib: Library) => ({
  projects: lib.projects.map((p) => ({ id: p.id, name: p.name, subtitle: p.subtitle, url: p.url, dates: [p.start, p.end].filter(Boolean).join(' – '), description: p.description })),
  skills: lib.skills.map((s) => ({ id: s.id, name: s.name, details: s.details })),
  experience: lib.experience.map((e) => ({ id: e.id, position: e.position, company: e.company, location: e.location, dates: [e.start, e.current ? 'Present' : e.end].filter(Boolean).join(' – '), description: e.description })),
  certifications: lib.certifications.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, date: c.date, url: c.url })),
  notes: lib.notes,
})

/** The CV already used at this company and department, as check_jobs and the save tools report it. */
/**
 * Checks a just-saved letter with the server's detector and records it on the card. Without a detector it says
 * how to check in the browser instead; a detector failure is reported, never thrown, so the letter stays saved.
 */
async function autoCheck(env: Env & db.Store, app: Application, lang: Lang, target: number) {
  const tool = detectorName(env)
  if (!tool) return { checked: false, next: 'No server detector: check this letter in the browser (GPTZero, then Pangram on the final version) and save the result with record_ai_check.' }
  try {
    const aiPercent = await detectAi(env, await documentText(env, app, 'letter', lang))
    await addAiCheck(env, app, { doc: 'letter', lang, tool, aiPercent, at: new Date().toISOString() })
    const passes = aiPercent <= target
    return {
      checked: true,
      tool,
      ai_percent: aiPercent,
      target,
      passes,
      next: passes
        ? 'Passes: nothing to do.'
        : 'Above the target. If this was the first version, you may rewrite it ONCE in the user\'s voice, in natural full sentences (never fragments), same facts; then re-read the rewrite for style before saving it: it must still sound like the user and read well (no stiff or odd wording, no filler, no broken rhythm, no lost specifics); fix any such line by hand, which does not count as a second rewrite, and save it again. After that one rewrite, keep it whatever the score: note the score on the card and move on.',
    }
  } catch (err) {
    return { checked: false, error: (err as Error).message, next: 'Check it in the browser instead and save the result with record_ai_check.' }
  }
}

function companyCv(a: Application | undefined) {
  return a
    ? { application_id: a.id, stage: a.stage, title: a.title, company: a.company, department: a.department ?? '', resume_id: a.resumeId }
    : null
}

/** Refuses a second tailored CV for the same company department (see the instructions). */
function guardCompanyCv(apps: Application[], job: { company: string }, department: string, excludeId: string | undefined, separate: boolean) {
  if (separate) return
  const known = cvAtCompany(apps, job.company, department, excludeId)
  if (!known) return
  throw new ToolError(
    `You already have a CV at ${known.company}${known.department ? ` (${known.department})` : ''}: resume_id "${known.resumeId}", on the card "${known.title}" (${stageLabel(known.stage)}). ` +
      'Recruiters of that department see every application, so reuse that CV: save_application { title, company, url, stage: "draft", resume_id: "' +
      known.resumeId +
      '", …card fields } and then write a new motivation letter for this job. ' +
      'Only if this job is in a clearly different department, call save_tailored_cv again with card.department set and separate_cv: true.',
  )
}

async function promptContext(env: Env): Promise<PromptContext> {
  const [profile, master] = await Promise.all([db.getSearchProfile(env), masterResume(env).catch(() => null)])
  const github = master?.content[master.sourceLang]?.personal.contacts.find((c) => c.type === 'github')
  return { profile, detector: detectorName(env), github: github?.url || github?.value || '' }
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

interface Tool {
  name: string
  description: string
  inputSchema: Json
  run: (env: Env, args: Json, origin: string) => Promise<unknown>
}

const jobSchema = {
  type: 'object',
  description: 'The posting: title is required; pass the full job text as description.',
  properties: {
    title: { type: 'string' },
    company: { type: 'string' },
    url: { type: 'string', description: 'the posting (LinkedIn, Indeed, arbeitsagentur.de, company page…)' },
    location: { type: 'string' },
    description: { type: 'string' },
    logo: { type: 'string', description: 'logo URL from read_job_posting' },
  },
  required: ['title'],
}
const langSchema = { type: 'string', enum: [...LANGS] }
const docSchema = { type: 'string', enum: ['cv', 'letter'] }
const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required })

const libraryItemSchema = {
  type: 'object',
  description:
    'projects: name, subtitle, url, start, end, description · skills: name, details · experience: position, company, url, location, start, end, current, description · certifications: name, issuer, date, url. Dates like "2025/03"; descriptions as "- " bullets.',
}

/**
 * A LinkedIn posting hides the company's apply link from signed-out readers. Where its Apply button leads, the same
 * job on the Arbeitsagentur board (whose listing often links the company's posting), and what to do next.
 */
async function linkedInApply(page: JobPage) {
  if (page.source !== 'LinkedIn') return null
  const elsewhere = page.title && page.company ? await findOnBa(page.title, page.company).catch(() => null) : null
  const found = elsewhere ? { title: elsewhere.title, company: elsewhere.company, arbeitsagentur: elsewhere.url, company_posting: elsewhere.external_url || null } : null
  const easy = page.applyOn === 'easy_apply'
  const stub = page.description.length < 1200
    ? `The LinkedIn text is short, probably a stub: read the full ad (read_job_posting on ${found ? 'same_job_elsewhere.arbeitsagentur or company_posting' : 'the link it names, or the company posting'}) before judging the fit or writing. `
    : ''
  return {
    apply_on: easy ? 'LinkedIn Easy Apply' : page.applyOn === 'company_site' ? "the company's site (LinkedIn hides the link)" : 'unknown',
    same_job_elsewhere: found,
    next: stub + (easy
      ? `LinkedIn Easy Apply: the form exists only on LinkedIn. Look for the same job on ${page.company || 'the company'}'s careers page${found ? ' (or the Arbeitsagentur listing above)' : ''}; if it is there, use that form (read_application_form). Otherwise save the LinkedIn link as apply_url and the usual Easy Apply questions (contact, CV, a few screening questions) with save_form_answers only if the user's browser shows them.`
      : `Never save the LinkedIn link as apply_url. ${found?.company_posting ? `Pass ${found.company_posting} to read_application_form; it leads to the company's form. ` : ''}Otherwise find the posting on ${page.company || 'the company'}'s careers page (web search "${page.company} ${page.title} careers", or the browser where the user is signed in to LinkedIn: Apply opens the company form) and pass that page to read_application_form.`),
  }
}

const TOOLS: Tool[] = [
  {
    name: 'get_profile',
    description:
      'The candidate: master CV (readable), knowledge base (library of extra projects, skills, experience, certificates and notes), job-search profile, all CVs, the board by stage, and the AI budget and detector. Call once at the start.',
    inputSchema: obj({}),
    run: async (env, _args, origin) => {
      const [master, library, profile, resumes, apps, spend, columns] = await Promise.all([
        masterResume(env),
        db.getLibrary(env),
        db.getSearchProfile(env),
        db.listResumes(env),
        db.listApplications(env),
        aiSpend(env),
        db.getBoardColumns(env),
      ])
      const content = master.content[master.sourceLang]!
      // A fresh account has an empty search profile: its defaults (German limit "basic", any role) would steer a
      // job search wrong, so the AI must ask the user first. Clients without MCP prompts (ChatGPT) only see this.
      const missing = (
        [
          ['roles', profile.roles],
          ['locations', profile.locations],
          ['germanLevel', searchesGermany(profile) ? profile.germanLevel : 'n/a'],
          ['availability', profile.availability],
          ['workPermit', profile.workPermit],
        ] as const
      )
        .filter(([, v]) => !v?.trim())
        .map(([k]) => k)
      const setup_needed = missing.length
        ? `The search profile is incomplete (missing: ${missing.join(', ')}). Before searching for or rating jobs, ask the user for these (the country they search in, roles wanted, cities and radius, their German level if they search in Germany and the highest German requirement they accept as germanLimit, hours per week, start date, work permit or visa limits) and save the answers with save_search_profile. Until then, take nothing for granted: the defaults (germanLimit "basic", any role) are placeholders, not the user's wishes.`
        : undefined
      const emptyCv = !content.personal.name.trim() || !content.sections.some((s) => isItemSection(s) && s.items.length > 0)
      const cv_setup_needed = emptyCv
        ? `The master CV (id "${master.id}") is empty. Before anything else, ask the user for their CV: they can paste its text or upload a PDF here, or import it on the website (${origin}/edit). Then fill the master CV with edit_cv: personal (name, email, phone, location, linkedin, github), headline, summary, and add items to experience, education, skills, languages and certifications, word for word from their CV. Never invent anything.`
        : undefined
      return {
        ...(cv_setup_needed && { cv_setup_needed }),
        ...(setup_needed && { setup_needed }),
        master_cv: { id: master.id, language: master.sourceLang, languages: Object.keys(master.content), markdown: cvMarkdown(content) },
        knowledge_base: libraryText(library),
        search_profile: profile,
        cvs: resumes.map((r) => {
          const m = toMeta(r)
          return { id: m.id, name: m.name, kind: m.kind, languages: m.langs, job: m.job ? `${m.job.title} – ${m.job.company}` : null, match_score: m.job?.matchScore ?? null }
        }),
        board: Object.fromEntries(boardStages(columns).map((s) => [stageLabel(s, columns), apps.filter((a) => a.stage === s).length])),
        board_columns: columns,
        site_ai: { ...aiStatus(env), spend, detector: detectorName(env) },
        editor: `${origin}/edit`,
      }
    },
  },
  {
    name: 'save_search_profile',
    description:
      'Updates the job-search profile (only the keys given): country (where the user searches; empty = Germany, where the German-level rules and search_jobs apply), roles, locations, radiusKm, jobTypes [working_student, student_assistant, internship, thesis, part_time, full_time, trainee], workModes [onsite, hybrid, remote], germanLevel, germanLimit (none|basic|B1|B2|C1|any), availability, start, salary, workPermit, targets, sites (job sites to search first, one per line), avoid, docLangs (posting|posting+en|en|all), maxAiPercent, perRun, minFit, notes, cvRules (the user\'s own rules for their CVs and letters, on top of the common ones; read the current text first to append). Only save what the user said.',
    inputSchema: obj({ profile: { type: 'object' } }, ['profile']),
    run: async (env, args) => {
      const current = await db.getSearchProfile(env)
      const profile = cleanSearchProfile({ ...current, ...((args.profile as Json) ?? {}) }, current)
      profile.updatedAt = new Date().toISOString()
      await db.saveSearchProfile(env, profile)
      return { saved: true, search_profile: profile }
    },
  },
  {
    name: 'update_library',
    description:
      "Edits the knowledge base the CV and letter writer picks from: add items, update or remove items by id (ids from get_profile), and append facts to the notes. Only facts the user confirmed or that are published (e.g. their GitHub); never invented. Every assistant reads the knowledge base, so it holds only what may appear in applications: never store private background (company ownership, family or tax matters) even when the user explains it.",
    inputSchema: obj({
      add: obj(Object.fromEntries(LIBRARY_LISTS.map((l) => [l, { type: 'array', items: libraryItemSchema }]))),
      update: { type: 'array', items: obj({ list: { type: 'string', enum: LIBRARY_LISTS }, id: { type: 'string' }, fields: libraryItemSchema }, ['list', 'id', 'fields']) },
      remove: { type: 'array', items: obj({ list: { type: 'string', enum: LIBRARY_LISTS }, id: { type: 'string' } }, ['list', 'id']) },
      notes_append: { type: 'string', description: 'text added at the end of the notes' },
      notes_replace: {
        type: 'array',
        description: 'edit the notes: each { find, replace } swaps one exact passage of the notes (replace "" deletes it); applied before notes_append',
        items: obj({ find: { type: 'string' }, replace: { type: 'string' } }, ['find', 'replace']),
      },
    }),
    run: async (env, args) => {
      const lib = await db.getLibrary(env)
      const lists = lib as unknown as Record<LibraryList, Record<string, unknown>[]>
      const added: { list: LibraryList; id: string; name: string }[] = []
      const problems: string[] = []
      const add = (args.add ?? {}) as Json
      for (const l of LIBRARY_LISTS) {
        for (const fields of list<Json>(add[l])) {
          const item = newItem(l) as unknown as Record<string, unknown>
          setLibraryFields(item, l, fields)
          const name = String(item.name ?? item.position ?? '')
          if (!name) {
            problems.push(`${l}: an item without ${l === 'experience' ? 'position' : 'name'} was skipped`)
            continue
          }
          lists[l].push(item)
          added.push({ list: l, id: String(item.id), name })
        }
      }
      for (const u of list<Json>(args.update)) {
        const l = u.list as LibraryList
        const item = LIBRARY_LISTS.includes(l) ? lists[l].find((i) => i.id === u.id) : undefined
        if (item) setLibraryFields(item, l, (u.fields as Json) ?? {})
        else problems.push(`update: ${String(u.list)} item "${String(u.id)}" not found`)
      }
      for (const r of list<Json>(args.remove)) {
        const l = r.list as LibraryList
        const before = LIBRARY_LISTS.includes(l) ? lists[l].length : 0
        if (before) lists[l] = lists[l].filter((i) => i.id !== r.id)
        if (!before || lists[l].length === before) problems.push(`remove: ${String(r.list)} item "${String(r.id)}" not found`)
      }
      for (const r of Array.isArray(args.notes_replace) ? (args.notes_replace as Record<string, unknown>[]) : []) {
        const find = typeof r?.find === 'string' ? r.find : ''
        if (!find || !lib.notes.includes(find)) {
          problems.push(`notes_replace: passage not found: "${find.slice(0, 60)}"`)
          continue
        }
        lib.notes = lib.notes.replace(find, typeof r.replace === 'string' ? r.replace.slice(0, 20_000) : '').replace(/\n{3,}/g, '\n\n')
      }
      const extra = str(args.notes_append, 20_000)
      if (extra) lib.notes = [lib.notes.trimEnd(), extra].filter(Boolean).join('\n\n')
      await db.saveLibrary(env, lib)
      return { saved: true, added, problems, counts: Object.fromEntries(LIBRARY_LISTS.map((l) => [l, lists[l].length])) }
    },
  },
  {
    name: 'search_jobs',
    description:
      "Searches the Bundesagentur für Arbeit job board (Germany's largest; also lists many company and board postings) and marks the results already on the board. For LinkedIn, Indeed and StepStone use the browser. Free.",
    inputSchema: obj(
      {
        what: { type: 'string', description: 'keywords, e.g. "Werkstudent Data Engineering" (try German and English variants)' },
        where: { type: 'string', description: 'city or postcode (default: the city on the CV)' },
        radius_km: { type: 'number', description: 'default from the search profile' },
        kind: { type: 'string', enum: ['any', 'job', 'internship'], description: 'job = regular jobs; internship = internships, trainee and many working-student ads' },
        part_time: { type: 'boolean' },
        days: { type: 'number', description: 'first published within the last N days (default 7)' },
        page: { type: 'number' },
        size: { type: 'number', description: 'results per page, max 50 (default 25)' },
      },
      ['what'],
    ),
    run: async (env, args) => {
      if (!str(args.what, 200)) throw new Error('"what" is required: the keywords to search for, e.g. "Werkstudent Data Analyst".')
      const [profile, master, apps] = await Promise.all([db.getSearchProfile(env), masterResume(env), db.listApplications(env)])
      if (!searchesGermany(profile))
        throw new ToolError(
          `search_jobs searches the German Bundesagentur board only, and this user's job search is in ${profile.country.trim()}. Search the web and the browser instead (LinkedIn Jobs, Indeed and the country's job boards, the university's careers service, company career pages).`,
        )
      const num = (v: unknown, fallback: number, min: number, max: number) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
      const result = await searchBa({
        what: str(args.what, 200),
        where: str(args.where, 100) || cityOf(master.content[master.sourceLang]!) || 'Berlin',
        radiusKm: num(args.radius_km, profile.radiusKm || 50, 0, 200),
        kind: args.kind === 'job' || args.kind === 'internship' ? args.kind : 'any',
        partTime: args.part_time === true,
        days: num(args.days, 7, 1, 100),
        page: num(args.page, 1, 1, 50),
        size: num(args.size, 25, 1, 50),
      })
      // The board's own date filter goes by the last change, so old ads that were edited come back: keep the ones first published within the window.
      const since = new Date(Date.now() - num(args.days, 7, 1, 100) * 86_400_000).toISOString().slice(0, 10)
      const fresh = result.jobs.filter((j) => !j.first_published || j.first_published >= since)
      return {
        total: result.total,
        page: result.page,
        dropped_as_older: result.jobs.length - fresh.length,
        jobs: fresh.map((j) => {
          const known = findOnBoard(apps, { url: j.url, title: j.title, company: j.company }) ?? (j.external_url ? findOnBoard(apps, { url: j.external_url }) : undefined)
          return { ...j, on_board: known ? { id: known.id, stage: known.stage } : null, cv_at_company: companyCv(cvAtCompany(apps, j.company, '', known?.id)) }
        }),
        next: 'read_job_posting(url) gives the full text (external_url is the original posting when there is one).',
      }
    },
  },
  {
    name: 'check_jobs',
    description:
      'Which of these postings are already on the board (same link, or same title and company on another board), and cv_at_company: a CV already used at the same company and department, to reuse instead of tailoring a new one. Use before preparing anything.',
    inputSchema: obj(
      {
        jobs: {
          type: 'array',
          items: obj({ url: { type: 'string' }, title: { type: 'string' }, company: { type: 'string' }, department: { type: 'string' } }),
        },
      },
      ['jobs'],
    ),
    run: async (env, args) => {
      const apps = await db.listApplications(env)
      return {
        jobs: list<Json>(args.jobs)
          .slice(0, 200)
          .map((j) => {
            const job = { url: str(j.url, 2000), title: str(j.title, 300), company: str(j.company, 300), department: str(j.department, 300) }
            const known = findOnBoard(apps, job)
            return {
              ...job,
              on_board: known ? { id: known.id, stage: known.stage, title: known.title, company: known.company } : null,
              cv_at_company: companyCv(cvAtCompany(apps, job.company, job.department, known?.id)),
            }
          }),
      }
    },
  },
  {
    name: 'read_job_posting',
    description:
      'Reads a job posting from its link without AI (LinkedIn, Arbeitsagentur, Greenhouse, Lever, Workday, SmartRecruiters, Ashby, Personio, schema.org pages, other pages via a headless browser) and finds the company logo. Returns title, company, location, description, logo. If it fails (login wall, bot check, e.g. Indeed), use the text visible in your browser instead.',
    inputSchema: obj({ url: { type: 'string' } }, ['url']),
    run: async (env, args) => {
      const page = await readJobPage(env, str(args.url, 2000), async () => undefined)
      const linkedInId = linkedInJobId(new URL(page.url))
      return {
        // A LinkedIn search-results link carries session noise: give the job's own link to save on the card.
        url: linkedInId ? `https://www.linkedin.com/jobs/view/${linkedInId}` : page.url,
        title: page.title,
        company: page.company,
        location: page.location,
        description: page.clean ? page.description : page.description.slice(0, 12_000),
        description_is_whole_page: !page.clean,
        logo: await findLogo(env, page.url, page.html),
        source: jobSource(page.url),
        ...(await linkedInApply(page)),
      }
    },
  },
  {
    name: 'get_tailoring_material',
    description:
      'Everything needed to write a tailored CV yourself: the rules, the candidate material with line references (refs), and the answer format for save_tailored_cv. Free.',
    inputSchema: obj({ strict: { type: 'boolean', description: 'true (default): bullets word for word, text must be ""; false: bullets may be rephrased within their own line' } }),
    run: async (env, args) => {
      const [master, profile] = await Promise.all([masterResume(env), db.getSearchProfile(env)])
      const strict = args.strict !== false
      return {
        rules: systemPrompt(master.sourceLang, strict, profile.cvRules),
        material: tailoringMaterial(master.content[master.sourceLang]!, await db.getLibrary(env)),
        answer_format: TAILOR_SCHEMA,
        language_of_answer: LANG_LABELS[master.sourceLang].name,
        next: 'Call save_tailored_cv with { job, cv: <answer>, strict, card }.',
      }
    },
  },
  {
    name: 'save_tailored_cv',
    description:
      'Saves a tailored CV you wrote (answer format from get_tailoring_material). The server keeps referenced lines word for word, fact-checks headline/summary/skills against the material, adds matching ATS keywords from the skill lists, creates the CV and puts it on the board as "Draft" (or on the given application) with the card details you pass. Free unless score=true or languages are given (site AI). Returns the CV id, fact-check notes and the card.',
    inputSchema: obj(
      {
        job: jobSchema,
        cv: { ...TAILOR_SCHEMA, description: 'your answer, format from get_tailoring_material' },
        strict: { type: 'boolean', description: 'must match the strict value used with get_tailoring_material (default true)' },
        application_id: { type: 'string', description: 'board card this CV is for, if it already exists' },
        card: obj(cardSchema),
        separate_cv: {
          type: 'boolean',
          description: 'true only when the company already has your CV in a clearly different department (set card.department)',
        },
        replace_resume_id: {
          type: 'string',
          description: 'rewrite this tailored CV in place (e.g. shortened after a layout check) instead of creating a new one; translations are dropped',
        },
        score: { type: 'boolean', description: 'compute the match score with the site AI (about $0.003)' },
        languages: { type: 'array', items: langSchema, description: 'also translate with the site AI (about $0.001 each); or translate yourself with save_cv_translation' },
        full_width: {
          type: 'array',
          items: { type: 'string', enum: [...FULL_WIDTH_TYPES] },
          description: 'sections to print across the whole page instead of in a column, e.g. ["languages"] when the layout check says it sits alone in the side column',
        },
      },
      ['job', 'cv'],
    ),
    run: async (env, args, origin) => {
      const job = jobArg(args.job)
      const cv = args.cv as TailorOutput
      if (!cv || typeof cv !== 'object') throw new ToolError('cv is required')
      const card = (args.card ?? {}) as Json
      const replaced = args.replace_resume_id ? await needResume(env, args.replace_resume_id) : null
      if (replaced) {
        if (replaced.kind === 'master') throw new ToolError('replace_resume_id must be a tailored CV, not the master CV.')
        await refuseSent(env, replaced)
      } else {
        guardCompanyCv(await db.listApplications(env), job, str(card.department, 300), str(args.application_id) || undefined, args.separate_cv === true)
      }
      const base = await masterResume(env)
      const created = await createTailoredCv(env, {
        base,
        job,
        applicationId: str(args.application_id) || undefined,
        languages: list<Lang>(args.languages).filter(isLang),
        useLibrary: true,
        strict: args.strict !== false,
        authored: cv,
        scoreIt: args.score === true,
      })
      let { resume, application } = created
      const wide = list<string>(args.full_width).filter((t) => (FULL_WIDTH_TYPES as readonly string[]).includes(t))
      if (wide.length) {
        for (const content of Object.values(resume.content)) {
          for (const s of content?.sections ?? []) if (wide.includes(s.type)) s.placement = 'full'
        }
        if (!replaced) await db.saveResume(env, resume)
      }
      if (replaced) {
        // Same CV id and look; only the content and job info are new. Cards move back to it.
        // Sections keep the placement the CV had (e.g. languages made full width after a layout check).
        for (const [lang, content] of Object.entries(resume.content)) {
          const before = replaced.content[lang as Lang] ?? replaced.content[replaced.sourceLang]
          for (const s of content?.sections ?? []) {
            const old = before?.sections.find((o) => o.type === s.type)
            if (old && !wide.includes(s.type)) s.placement = old.placement
          }
        }
        const merged: Resume = { ...replaced, content: resume.content, sourceLang: resume.sourceLang, job: resume.job, updatedAt: new Date().toISOString() }
        await db.saveResume(env, merged)
        await db.deleteResume(env, resume.id)
        for (const a of await db.listApplications(env)) {
          if (a.resumeId !== resume.id) continue
          const relinked = { ...a, resumeId: merged.id, updatedAt: merged.updatedAt }
          await db.putApplication(env, relinked)
          if (application?.id === a.id) application = relinked
        }
        resume = merged
      }
      let saved = application
      if (saved && saved.resumeId === resume.id) {
        saved = structuredClone(saved)
        applyCardFields(saved, card)
        await fillLogo(env, saved)
        saved.updatedAt = new Date().toISOString()
        await db.putApplication(env, saved)
      }
      return {
        resume_id: resume.id,
        name: resume.name,
        languages: Object.keys(resume.content),
        match_score: resume.job?.matchScore ?? null,
        notes: resume.job?.notes,
        layout: await layoutOf(env, origin, resume, resume.sourceLang),
        application: saved ? applicationSummary(saved, origin) : null,
        board:
          saved && saved.resumeId !== resume.id
            ? `This posting is already on the board as "${stageLabel(saved.stage)}" with another CV, so this CV was not attached. To attach it: save_application { id: "${saved.id}", resume_id: "${resume.id}" }.`
            : undefined,
        edit_url: `${origin}/edit/cv/${resume.id}`,
      }
    },
  },
  {
    name: 'tailor_cv_with_site_ai',
    description:
      "Tailors a CV with the site's own model (about $0.005 with score; counts toward the user's AI budget), optionally translated and with a motivation letter, and puts it on the board as \"Draft\". Use only when you cannot write it yourself.",
    inputSchema: obj(
      {
        job: jobSchema,
        languages: { type: 'array', items: langSchema },
        letter_language: { ...langSchema, description: 'also write the motivation letter in this language' },
        application_id: { type: 'string' },
        department: { type: 'string', description: 'team or department named in the posting' },
        separate_cv: { type: 'boolean', description: 'true only when the company already has your CV in a clearly different department' },
      },
      ['job'],
    ),
    run: async (env, args, origin) => {
      const job = jobArg(args.job)
      guardCompanyCv(await db.listApplications(env), job, str(args.department, 300), str(args.application_id) || undefined, args.separate_cv === true)
      const { resume, application } = await createTailoredCv(env, {
        base: await masterResume(env),
        job,
        applicationId: str(args.application_id) || undefined,
        languages: list<Lang>(args.languages).filter(isLang),
        useLibrary: true,
        strict: true,
        letterLang: isLang(args.letter_language) ? args.letter_language : null,
      })
      return {
        resume_id: resume.id,
        name: resume.name,
        languages: Object.keys(resume.content),
        match_score: resume.job?.matchScore ?? null,
        notes: resume.job?.notes,
        application: application ? applicationSummary(application, origin) : null,
        edit_url: `${origin}/edit/cv/${resume.id}`,
      }
    },
  },
  {
    name: 'get_cv',
    description:
      'A CV as readable Markdown in one language (also the text to paste into an AI detector, without the first three lines), its translatable fields as {k, v} for save_cv_translation (v is the source-language text; with another lang, current is that language\'s text, to edit an existing translation), and its design in edit_cv\'s names: template, style, and every section with its placement, visibility and items (ids, hidden ones included).',
    inputSchema: obj({ resume_id: { type: 'string' }, lang: langSchema }, ['resume_id']),
    run: async (env, args) => {
      const resume = await needResume(env, args.resume_id)
      const lang = isLang(args.lang) && resume.content[args.lang] ? args.lang : resume.sourceLang
      const content = resume.content[lang]!
      // v stays the source text to translate from; another language also gets its own text, so a translation can be edited.
      const current = lang === resume.sourceLang ? null : new Map(translatableFields(content).map((f) => [f.key, f.get()]))
      return {
        resume_id: resume.id,
        name: resume.name,
        language: lang,
        source_language: resume.sourceLang,
        languages: Object.keys(resume.content),
        job: resume.job ? { title: resume.job.title, company: resume.job.company, url: resume.job.url, match_score: resume.job.matchScore } : null,
        markdown: cvMarkdown(content),
        translatable_fields: translatableFields(resume.content[resume.sourceLang]!).map((f) => ({
          k: f.key,
          v: f.get(),
          ...(current && { current: current.get(f.key) ?? '' }),
        })),
        design: {
          template: resume.template,
          style: styleView(resume.style),
          sections: content.sections.map((s) => ({
            id: s.id,
            type: s.type,
            title: s.title,
            placement: s.placement,
            visible: s.visible,
            ...(isItemSection(s)
              ? { items: (s.items as SectionItem[]).map((i) => ({ id: i.id, label: itemHead(i), ...(i.hidden && { hidden: true }) })) }
              : { show_title: s.showTitle ?? TEMPLATE_MAP[resume.template].summaryTitle }),
          })),
        },
      }
    },
  },
  {
    name: 'save_cv_translation',
    description:
      'Saves your translation of a CV: translate every translatable field from get_cv (source language) and pass them as {k, v}. Rules: ' +
      'keep markup ("- " bullets, **bold**, links), names of companies/tools/products, numbers and CEFR levels; standard CV terms of the target language; no added or removed facts. Values that lose a number are kept in the source language and reported.',
    inputSchema: obj(
      {
        resume_id: { type: 'string' },
        lang: langSchema,
        fields: { type: 'array', items: obj({ k: { type: 'string' }, v: { type: 'string' } }, ['k', 'v']) },
      },
      ['resume_id', 'lang', 'fields'],
    ),
    run: async (env, args, origin) => {
      const resume = await needResume(env, args.resume_id)
      const lang = needLang(args.lang)
      if (lang === resume.sourceLang) throw new ToolError('That is the source language of this CV.')
      const source = resume.content[resume.sourceLang]!
      const target = structuredClone(source)
      const given = new Map(list<{ k: string; v: string }>(args.fields).map((f) => [f.k, text(f.v)]))
      const problems: string[] = []
      for (const f of translatableFields(target)) {
        const original = f.get()
        const value = given.get(f.key)
        if (!value) problems.push(`${f.key}: missing, kept the source text`)
        else if (translationProblem(original, value)) problems.push(`${f.key}: ${translationProblem(original, value)}, kept the source text`)
        else f.set(value)
      }
      resume.content[lang] = target
      resume.translations[lang] = { sourceHash: contentHash(source), at: new Date().toISOString() }
      resume.updatedAt = new Date().toISOString()
      await db.saveResume(env, resume)
      return { resume_id: resume.id, language: lang, saved: true, problems, layout: await layoutOf(env, origin, resume, lang) }
    },
  },
  {
    name: 'edit_cv',
    description:
      'Edits a CV in place, the master CV included, without rewriting it and without dropping its translations: everything the website editor can change. Design (template), style (fonts, font size, spacing, margins, column width, photo and its size, contact icons, header alignment, accent, text and page colour), section placement (main/side/full), order, visibility, titles and the summary heading, hide, show, move, change, add or remove items, headline and summary, name and contact details (personal). ' +
      'Style, placement, order, hidden and removed items apply to every language; text goes to `lang` (default: the source language), and a change of source text lists the translations to redo with save_cv_translation. ' +
      'Only facts the user stated or confirmed, never invented. Item ids come from get_cv (translatable_fields keys) or get_profile. ' +
      'design_from gives a CV the look of another one, e.g. older CVs the master CV\'s new design. For the one-page fit, change content and placement here, then let fit_cv_to_page set the font size, spacing and column width. ' +
      'Refused for a tailored CV that was already sent. Returns the layout check.',
    inputSchema: obj(
      {
        resume_id: { type: 'string', description: 'the CV; get_profile lists them, the master CV included' },
        lang: { ...langSchema, description: 'language of the text edits (default: the source language)' },
        design_from: {
          type: 'string',
          description:
            'copy the design of another CV ("master" for the master CV): template, style, and each section\'s placement and order; the content and hidden items stay. Applied before template and style, then run fit_cv_to_page',
        },
        template: {
          type: 'string',
          enum: TEMPLATES.map((t) => t.id),
          description: `the design: ${TEMPLATES.map((t) => `${t.id} (${t.layout === 'single' ? 'one column' : 'two columns'})`).join(', ')}. Like in the editor, it resets colours, fonts, spacing and section placement to the template's own; style and sections given in the same call apply on top`,
        },
        style: obj({
          font_size: { type: 'number', description: 'pt, 9–12' },
          line_height: { type: 'number', description: '1.05–1.6' },
          margin_x: { type: 'number', description: 'mm' },
          margin_y: { type: 'number', description: 'mm' },
          section_gap: { type: 'number', description: 'px between sections' },
          item_gap: { type: 'number', description: 'px between entries' },
          column_ratio: { type: 'number', description: '% width of the main column, 35–70' },
          show_photo: { type: 'boolean' },
          photo_size: { type: 'number', description: 'px, 50–170' },
          show_icons: { type: 'boolean', description: 'contact icons (steady and serif templates); off, steady separates the contacts with dots' },
          header_align: { type: 'string', enum: ['left', 'center'], description: 'name, headline and contacts: as the template sets them, or centred' },
          font: { type: 'string', enum: [...FONTS] },
          heading_font: { type: 'string', enum: ['', ...FONTS], description: '"" uses the body font' },
          accent: { type: 'string', description: 'colour of headings, lines and icons, hex like "#000000"' },
          text: { type: 'string', description: 'body text colour, hex like "#1f1f1f"' },
          background: { type: 'string', description: 'page colour, hex like "#ffffff"' },
        }),
        sections: {
          type: 'array',
          description: 'per section type: placement, visibility, title',
          items: obj(
            {
              type: { type: 'string', enum: [...SECTION_TYPES] },
              id: { type: 'string', description: "the section's id from get_cv design, when the CV has two sections of this type (e.g. courses and skills)" },
              placement: { type: 'string', enum: ['main', 'side', 'full'] },
              visible: { type: 'boolean' },
              title: { type: 'string', description: 'heading in `lang`' },
              show_title: { type: 'boolean', description: 'summary only: print its heading' },
            },
            ['type'],
          ),
        },
        order: { type: 'array', items: { type: 'string', enum: [...SECTION_TYPES] }, description: 'section types top to bottom; the others follow in their current order' },
        items: {
          type: 'array',
          description: 'existing items to hide, show or change',
          items: obj(
            {
              id: { type: 'string' },
              hidden: { type: 'boolean' },
              after: { type: 'string', description: 'move the item behind this item of the same section, or "first" to put it on top' },
              fields: {
                type: 'object',
                description:
                  'fields to set: text in `lang` (description with "- " bullets and **bold**, details, name, position, company, degree, school, subtitle, location, issuer, and a date written in words like "Expected 2028"); start, end ("2026/09"), current (true/false), url, level and date apply to every language',
              },
            },
            ['id'],
          ),
        },
        add: {
          type: 'array',
          description: 'new items, added to every language (translate them afterwards); a section the CV does not have yet is created',
          items: obj(
            {
              section: { type: 'string', enum: SECTION_TYPES.filter((t) => t !== 'summary') },
              fields: { type: 'object', description: 'same field names as in items[].fields' },
              after: { type: 'string', description: 'id of the item to insert after, which also picks the section when the CV has two of this type (default: at the end of the first)' },
            },
            ['section', 'fields'],
          ),
        },
        remove: { type: 'array', items: { type: 'string' }, description: 'item ids to delete in every language' },
        headline: { type: 'string', description: 'in `lang`' },
        summary: { type: 'string', description: 'profile text in `lang`' },
        personal: obj({
          name: { type: 'string', description: 'full name as it should appear on the CV' },
          email: { type: 'string' },
          phone: { type: 'string' },
          location: { type: 'string', description: 'city and country in `lang`, e.g. "Bristol, UK"; a new one goes to every language, a change only to `lang`' },
          linkedin: { type: 'string', description: 'e.g. linkedin.com/in/name' },
          github: { type: 'string', description: 'e.g. github.com/name' },
          website: { type: 'string' },
          other: { type: 'array', items: { type: 'string' }, description: 'free contact lines, e.g. "WhatsApp: +212 …" or "Right to work in the UK"; replaces the existing ones, [] removes them' },
          order: {
            type: 'array',
            items: { type: 'string', enum: ['location', 'phone', 'email', 'linkedin', 'github', 'website', 'other'] },
            description: 'contact order on the CV, e.g. ["location", "phone", "email"]; contacts not named follow in their current order',
          },
        }),
      },
      ['resume_id'],
    ),
    run: async (env, args, origin) => {
      const resume = await needResume(env, args.resume_id)
      await refuseSent(env, resume)
      const lang = isLang(args.lang) && resume.content[args.lang] ? args.lang : resume.sourceLang
      const langs = Object.keys(resume.content) as Lang[]
      const changes = new Set<string>()
      const problems = new Set<string>()
      let sourceText = false

      // Another CV's design (the master's, after the user restyled it): its template, style and where each section sits.
      if (typeof args.design_from === 'string' && args.design_from.trim()) {
        const from = await needResume(env, args.design_from.trim())
        const order = from.content[from.sourceLang]?.sections ?? []
        if (from.id === resume.id) problems.add('design_from names this CV itself')
        else {
          resume.template = from.template
          resume.style = { ...from.style, showPhoto: from.style.showPhoto && !!resume.photo }
          for (const c of Object.values(resume.content)) {
            if (!c) continue
            // Its twin in the other CV: the same section id, else the one at the same place among its type (a CV can have two skills sections).
            type Sec = (typeof c.sections)[number]
            const twin = (sec: Sec) => order.find((x) => x.id === sec.id) ?? order.filter((x) => x.type === sec.type)[c.sections.filter((x) => x.type === sec.type).indexOf(sec)]
            const rank = new Map(c.sections.map((sec) => [sec, order.indexOf(twin(sec)!)] as const))
            for (const sec of c.sections) {
              const like = twin(sec)
              if (!like) continue
              sec.placement = like.placement
              if (sec.type === 'summary' && like.type === 'summary') sec.showTitle = like.showTitle
            }
            const at = (sec: Sec) => (rank.get(sec)! < 0 ? order.length : rank.get(sec)!)
            c.sections = c.sections.map((x, i) => ({ x, i })).sort((a, b) => at(a.x) - at(b.x) || a.i - b.i).map(({ x }) => x)
          }
          changes.add(`design of ${from.kind === 'master' ? 'the master CV' : `"${from.name}"`}`)
        }
      }

      // A new template brings its own style and placement, as in the editor; the style and sections below apply on top.
      if (args.template !== undefined && args.template !== resume.template) {
        const meta = TEMPLATE_MAP[args.template as keyof typeof TEMPLATE_MAP]
        if (!meta) problems.add(`template must be one of ${TEMPLATES.map((t) => t.id).join(', ')}`)
        else {
          resume.template = meta.id
          resume.style = { ...meta.style, showPhoto: meta.style.showPhoto && !!resume.photo }
          for (const c of Object.values(resume.content)) if (c) applyTemplatePlacement(c, meta.id)
          changes.add(`template ${meta.id}`)
        }
      }

      const st = (args.style ?? {}) as Json
      for (const [k, key, lo, hi] of STYLE_LIMITS) {
        const v = st[k]
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        const clamped = Math.min(hi, Math.max(lo, v))
        resume.style[key] = clamped as never
        changes.add(`${key} ${clamped}`)
      }
      if (typeof st.show_photo === 'boolean') {
        resume.style.showPhoto = st.show_photo
        changes.add(`photo ${st.show_photo ? 'shown' : 'hidden'}`)
      }
      if (typeof st.show_icons === 'boolean') {
        resume.style.showIcons = st.show_icons
        changes.add(`contact icons ${st.show_icons ? 'shown' : 'hidden'}`)
      }
      if (st.header_align !== undefined) {
        if (st.header_align === 'left' || st.header_align === 'center') {
          resume.style.headerAlign = st.header_align
          changes.add(`header ${st.header_align === 'center' ? 'centred' : 'as the template sets it'}`)
        } else problems.add('header_align must be "left" or "center"')
      }
      for (const [k, key] of [['font', 'font'], ['heading_font', 'headingFont']] as const) {
        const v = st[k]
        if (v === undefined) continue
        if (typeof v === 'string' && (FONTS as readonly string[]).concat(key === 'headingFont' ? [''] : []).includes(v)) {
          resume.style[key] = v
          changes.add(`${key} ${v || 'as body'}`)
        } else problems.add(`${k} must be one of ${FONTS.join(', ')}`)
      }
      for (const key of ['accent', 'text', 'background'] as const) {
        const v = st[key]
        if (v === undefined) continue
        if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
          resume.style[key] = v.toLowerCase()
          changes.add(`${key} ${v.toLowerCase()}`)
        } else problems.add(`${key} must be a hex colour like "#000000"`)
      }

      // Name and contact details are the same in every language; "" removes a contact. The location is
      // written per language, as in the editor: a new one goes to every language, a change only to `lang`.
      const personal = (args.personal ?? {}) as Json
      const contactIds = new Map<ContactType, string>()
      const setPersonal = (content: ResumeContent, isText: boolean) => {
        if (typeof personal.name === 'string') content.personal.name = str(personal.name, 120)
        for (const type of ['email', 'phone', 'location', 'linkedin', 'github', 'website'] as const) {
          const v = personal[type]
          if (typeof v !== 'string') continue
          const value = str(v, 200)
          const contacts = content.personal.contacts
          const at = contacts.findIndex((c) => c.type === type)
          if (!value) {
            if (at >= 0) contacts.splice(at, 1)
          } else if (at >= 0) {
            if (type !== 'location' || isText) contacts[at] = { ...contacts[at]!, value, url: '' }
          } else {
            if (!contactIds.has(type)) contactIds.set(type, uid('c'))
            contacts.push({ id: contactIds.get(type)!, type, value, url: '' })
          }
        }
        // Free lines (WhatsApp, right to work) go after the standard contacts.
        if (others) {
          content.personal.contacts = content.personal.contacts.filter((c) => c.type !== 'other')
          others.forEach((value, i) => content.personal.contacts.push({ id: otherIds[i]!, type: 'other', value, url: '' }))
        }
        if (order.length) {
          const rank = (type: string) => (order.includes(type) ? order.indexOf(type) : order.length)
          content.personal.contacts = content.personal.contacts.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.type) - rank(b.c.type) || a.i - b.i).map(({ c }) => c)
        }
      }
      const others = Array.isArray(personal.other) ? (personal.other as unknown[]).map((v) => str(v, 200)).filter(Boolean) : null
      const otherIds = others?.map(() => uid('c')) ?? []
      const order = list<string>(personal.order)
      if (order.length) changes.add('contact order')
      for (const k of ['name', 'email', 'phone', 'location', 'linkedin', 'github', 'website']) if (typeof personal[k] === 'string') changes.add(k)
      if (others) changes.add('other contact lines')

      // One id per added item, shared by every language.
      const added = list<Json>(args.add).map((a) => ({ section: a.section, fields: a.fields, after: a.after, id: uid('it') }))
      for (const l of langs) {
        const content = resume.content[l]!
        const isText = l === lang
        setPersonal(content, isText)
        for (const sec of list<Json>(args.sections)) {
          const s = content.sections.find((x) => (typeof sec.id === 'string' && sec.id ? x.id === sec.id : x.type === sec.type))
          if (!s) {
            problems.add(sec.id ? `no section ${String(sec.id)}` : `no ${String(sec.type)} section (adding an item to it with "add" creates it)`)
            continue
          }
          if (sec.placement === 'main' || sec.placement === 'side' || sec.placement === 'full') s.placement = sec.placement
          if (typeof sec.visible === 'boolean') s.visible = sec.visible
          if (isText && typeof sec.title === 'string' && str(sec.title)) s.title = str(sec.title, 120)
          if (typeof sec.show_title === 'boolean') {
            if (s.type === 'summary') s.showTitle = sec.show_title
            else problems.add('show_title applies to the summary only; other sections always show their title')
          }
          changes.add(`section ${s.type}`)
        }
        const order = list<string>(args.order)
        if (order.length) {
          const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length)
          content.sections = content.sections.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.type) - rank(b.s.type) || a.i - b.i).map((x) => x.s)
          changes.add('section order')
        }
        const items = () => content.sections.flatMap((s) => (isItemSection(s) ? (s.items as SectionItem[]) : []))
        for (const it of list<Json>(args.items)) {
          const item = items().find((x) => x.id === it.id)
          if (!item) {
            problems.add(`item ${String(it.id)} not found`)
            continue
          }
          if (typeof it.hidden === 'boolean') {
            item.hidden = it.hidden
            changes.add(`${it.hidden ? 'hid' : 'showed'} ${item.id}`)
          }
          if (typeof it.after === 'string') {
            const siblings = content.sections.flatMap((s) => (isItemSection(s) ? [s.items as SectionItem[]] : [])).find((xs) => xs.includes(item))!
            if (it.after !== 'first' && !siblings.some((x) => x.id === it.after && x !== item)) {
              problems.add(`${String(it.after)} is not another item of the section of ${item.id}`)
            } else {
              siblings.splice(siblings.indexOf(item), 1)
              siblings.splice(it.after === 'first' ? 0 : siblings.findIndex((x) => x.id === it.after) + 1, 0, item)
              changes.add(`moved ${item.id}`)
            }
          }
          if (it.fields && typeof it.fields === 'object') {
            // Dates, links, levels and the "current" flag are the same in every language; text only in `lang`.
            // A date written in words ("Expected 2028", "voraussichtlich 2028") is text of its language.
            const isShared = ([k, v]: [string, unknown]) =>
              SHARED_FIELDS.includes(k) && !(['start', 'end', 'date'].includes(k) && typeof v === 'string' && /\p{L}/u.test(v))
            const all = Object.entries(it.fields as Json)
            const shared = Object.fromEntries(all.filter(isShared))
            const own = Object.fromEntries(all.filter((e) => !isShared(e)))
            const fields = isText ? { ...shared, ...own } : shared
            if (Object.keys(fields).length) {
              for (const f of setItemFields(item, fields)) problems.add(`${item.id}.${f}: not a field of this item`)
              changes.add(`edited ${item.id}`)
              if (isText && l === resume.sourceLang && Object.keys(own).length) sourceText = true
            }
          }
        }
        const remove = list<string>(args.remove)
        if (remove.length) {
          for (const s of content.sections) if (isItemSection(s)) (s as { items: SectionItem[] }).items = (s.items as SectionItem[]).filter((x) => !remove.includes(x.id))
          remove.forEach((id) => changes.add(`removed ${id}`))
        }
        for (const a of added) {
          // With two sections of one type (e.g. courses and skills), `after` names the one to add to.
          const holdsAfter = (x: (typeof content.sections)[number]) => isItemSection(x) && (x.items as SectionItem[]).some((i) => i.id === a.after)
          let s = content.sections.find((x) => x.type === a.section && holdsAfter(x)) ?? content.sections.find((x) => x.type === a.section)
          // A section the CV does not have yet (e.g. projects on a CV made from a master without them) is created
          // after the last section that usually comes before it, so a short page can still be filled.
          if (!s && SECTION_TYPES.includes(a.section as SectionType) && a.section !== 'summary') {
            const created = newSection(a.section as SectionType, l, resume.template)
            const rank = (t: SectionType) => SECTION_TYPES.indexOf(t)
            const after = content.sections.reduce((last, x, i) => (rank(x.type) < rank(created.type) ? i : last), -1)
            content.sections.splice(after + 1, 0, created)
            changes.add(`created the ${created.type} section`)
            s = created
          }
          if (!s || !isItemSection(s)) {
            problems.add(`no ${String(a.section)} section to add to`)
            continue
          }
          if (!s.visible) {
            s.visible = true
            changes.add(`showed the ${s.type} section`)
          }
          const item = { ...newItem(s.type), id: a.id } as SectionItem
          setItemFields(item, (a.fields ?? {}) as Json)
          const list_ = s.items as SectionItem[]
          const at = typeof a.after === 'string' ? list_.findIndex((x) => x.id === a.after) : -1
          list_.splice(at >= 0 ? at + 1 : list_.length, 0, item)
          changes.add(`added ${a.id} to ${s.type}`)
          if (langs.length > 1) sourceText = true
        }
        if (isText && typeof args.headline === 'string') {
          content.personal.headline = str(args.headline, 200)
          changes.add('headline')
          if (l === resume.sourceLang) sourceText = true
        }
        if (isText && typeof args.summary === 'string') {
          const s = content.sections.find((x) => x.type === 'summary')
          if (s && s.type === 'summary') {
            s.text = str(args.summary, 5000)
            changes.add('summary')
            if (l === resume.sourceLang) sourceText = true
          } else problems.add('no summary section')
        }
      }
      if (!changes.size) throw new ToolError(`Nothing to change${problems.size ? `: ${[...problems].join('; ')}` : ''}.`)
      resume.updatedAt = new Date().toISOString()
      await db.saveResume(env, resume)
      const redo = sourceText ? langs.filter((l) => l !== resume.sourceLang) : []
      return {
        resume_id: resume.id,
        changed: [...changes],
        problems: [...problems],
        translations_to_redo: redo.length
          ? `${redo.join(', ')}: the source text changed; translate the new fields with save_cv_translation (all fields from get_cv), or edit them here with lang.`
          : undefined,
        layout: await layoutOf(env, origin, resume, lang),
      }
    },
  },
  {
    name: 'check_cv_layout',
    description:
      'Renders a CV like its PDF and reports how it sits on its pages: page count, how full the last page is, sections that run over a page break and empty space at a page bottom. Rule for a tailored CV: exactly one page, completely filled: every section whole, no empty space at the bottom of the page or under a column. Too long: hide the least relevant bullets, projects or skill groups (edit_cv) and keep everything the posting asks for. Spacing, font size and column width: never by hand, run fit_cv_to_page, which sets them for the fullest single page. Still too short after it, or a column that ends early: add a relevant bullet or project, or move a section to the other column, then fit_cv_to_page again. A tailored CV is ready only when its layout says "ok": true; only the master CV may have two pages. Free (the PDF is rendered once and cached).',
    inputSchema: obj({ resume_id: { type: 'string' }, lang: langSchema }, ['resume_id']),
    run: async (env, args, origin) => {
      const resume = await needResume(env, args.resume_id)
      const lang = isLang(args.lang) && resume.content[args.lang] ? args.lang : resume.sourceLang
      return { resume_id: resume.id, language: lang, ...(await layoutOf(env, origin, resume, lang)) }
    },
  },
  {
    name: 'fit_cv_to_page',
    description:
      'Makes a CV fill exactly one page with as little empty space as possible, automatically and without changing a word: on the real print page it tries font sizes (9–11 pt), line height, gaps, top and bottom margins and, on two-column templates, the column width, in every language of the CV, and saves the fullest setting that keeps each language on one page. Run it after every content or placement change instead of tuning the style by hand. ' +
      'It reports what only content can fix: too long even at the tightest readable setting (nothing is saved: hide the least relevant bullets, projects or skill groups with edit_cv, then run it again), still short at the roomiest setting (add a relevant bullet or project), or a column that ends early (move a section to the other column or make it full width with edit_cv). Refused for a tailored CV that was already sent. Free; takes up to a minute.',
    inputSchema: obj({ resume_id: { type: 'string', description: 'the CV; get_profile lists them' } }, ['resume_id']),
    run: async (env, args, origin) => {
      const resume = await needResume(env, args.resume_id)
      await refuseSent(env, resume)
      const langs = Object.keys(resume.content) as Lang[]
      const fits: [Lang, FitReport][] = []
      try {
        // One language after the other: each fit is a browser session.
        for (const l of langs) fits.push([l, await fitLayout(env as Env & db.Store, origin, resume, l)])
      } catch (err) {
        throw new ToolError(`The page fit is unavailable right now (${(err as Error).message}); try again in a minute.`)
      }
      const long = fits.filter(([, f]) => f.status === 'too_long')
      if (long.length) {
        return {
          resume_id: resume.id,
          changed: false,
          too_long: Object.fromEntries(long.map(([l, f]) => [l, `${f.layout.lastPageFill}% of a second page left over at 9 pt with the tightest spacing`])),
          next: 'Too much content for one page. Hide the least relevant bullets, projects or skill groups with edit_cv (about that much), keep everything the posting asks for, then run fit_cv_to_page again.',
        }
      }
      // One style serves every language: the tightest of their fits keeps the longest language on one page too.
      const density = (st: ResumeStyle) => st.fontSize * 10 + st.lineHeight
      const [longest, tightest] = fits.map(([l, f]) => [l, f.style] as const).reduce((a, b) => (density(b[1]) < density(a[1]) ? b : a))
      const before = fitStyle(resume.style)
      for (const key of FIT_KEYS) resume.style[key] = tightest[key]
      resume.updatedAt = new Date().toISOString()
      await db.saveResume(env, resume)
      const layout: Json = {}
      for (const l of langs) layout[l] = await layoutOf(env, origin, resume, l)
      const isOk = (l: Lang) => (layout[l] as { ok?: boolean }).ok === true
      const ok = langs.every(isOk)
      const short = fits.some(([, f]) => f.status === 'too_short')
      // The longest language sets the style; a shorter translation keeps some room that only its own text can fill.
      const shorter = isOk(longest) ? langs.filter((l) => !isOk(l)) : []
      return {
        resume_id: resume.id,
        changed: true,
        before,
        after: fitStyle(resume.style),
        layout,
        ok,
        next: ok
          ? 'One full page in every language. Nothing to do.'
          : short
            ? 'The page stays short even at the roomiest setting: add a relevant bullet or project with edit_cv, then run fit_cv_to_page again.'
            : shorter.length
              ? `One style serves every language and ${longest} is the longest, so ${shorter.join(' and ')} keeps room at the bottom. Fill it in that language only: edit_cv with lang "${shorter[0]}" and a slightly fuller bullet or one more fact the knowledge base states, then run fit_cv_to_page again.`
              : 'Fix what the layout lists with edit_cv (a column that ends early: move a section to the other column or make it full width; a section over a page break: shorten it), then run fit_cv_to_page again.',
      }
    },
  },
  {
    name: 'check_draft',
    description:
      'The last step of every prepared application, before you tell the user it is done: renders the card\'s CV in every language and every letter, like their PDFs. Each CV must fill exactly one page (whole sections, no empty space at the bottom of the page or under a column) and each letter must fit on one page; the card needs a CV and a letter, both in the language it is to be sent in. ready is true only when nothing is left to fix; otherwise fix each problem (edit_cv, save_cv_translation, save_motivation_letter) and check again. Free.',
    inputSchema: obj({ application_id: { type: 'string' } }, ['application_id']),
    run: async (env, args, origin) => {
      const app = await needApplication(env, args.application_id)
      const problems: string[] = []
      const unchecked = (what: string, error?: string) => `${what}: layout check unavailable${error ? ` (${error})` : ''}; try again in a minute`
      const cv = app.resumeId ? await db.getResume(env, app.resumeId) : null
      const cvLayouts: Json = {}
      if (!cv) problems.push('No CV on the card: save_tailored_cv, or save_application with the resume_id of the CV to send.')
      else {
        for (const lang of availableLangs(cv)) {
          const l = await layoutOf(env, origin, cv, lang)
          cvLayouts[lang] = l
          problems.push(...(l.checked ? (l.problems ?? []).map((p) => `CV ${lang}: ${p}`) : [unchecked(`CV ${lang}`, l.error)]))
        }
        if (app.lang && !cv.content[app.lang]) problems.push(`The card is to be sent in ${LANG_LABELS[app.lang].name}, but the CV has no ${LANG_LABELS[app.lang].name} version: save_cv_translation.`)
      }
      const letterLangs = LANGS.filter((l) => app.letters?.[l])
      const letterLayouts: Json = {}
      if (!letterLangs.length) problems.push('No motivation letter yet: save_motivation_letter.')
      else if (app.lang && !app.letters?.[app.lang]) problems.push(`No ${LANG_LABELS[app.lang].name} letter, the language the card is to be sent in: save_motivation_letter.`)
      for (const lang of letterLangs) {
        const l = await letterFitOf(env, origin, app, lang)
        letterLayouts[lang] = l
        problems.push(...(l.checked ? (l.problems ?? []).map((p) => `Letter ${lang}: ${p}`) : [unchecked(`Letter ${lang}`, l.error)]))
      }
      return {
        application_id: app.id,
        ready: !problems.length,
        problems,
        cv: cvLayouts,
        letters: letterLayouts,
        next: problems.length
          ? `Not ready: fix each problem, then check_draft again. ${problems.some((p) => p.startsWith('CV')) ? LAYOUT_FIX : ''} ${problems.some((p) => p.startsWith('Letter')) ? LETTER_FIX : ''}`.trim()
          : 'Ready: the CV fills one page in every language and every letter fits on one page.',
      }
    },
  },
  {
    name: 'translate_cv_with_site_ai',
    description: "Translates a CV with the site's model (about $0.001 per language; counts toward the AI budget).",
    inputSchema: obj({ resume_id: { type: 'string' }, languages: { type: 'array', items: langSchema } }, ['resume_id', 'languages']),
    run: async (env, args) => {
      const resume = await needResume(env, args.resume_id)
      await translateInto(env, resume, list<Lang>(args.languages).filter(isLang))
      resume.updatedAt = new Date().toISOString()
      await db.saveResume(env, resume)
      return { resume_id: resume.id, languages: Object.keys(resume.content) }
    },
  },
  {
    name: 'score_cv',
    description:
      "Match score of a tailored CV against its job with the site's model (about $0.003): overall %, per dimension, unmet requirements, missing ATS keywords.",
    inputSchema: obj({ resume_id: { type: 'string' } }, ['resume_id']),
    run: async (env, args) => {
      const resume = await rescore(env, await needResume(env, args.resume_id))
      const s = resume.job!.score!
      const reqs = new Map(resume.job!.analysis!.requirements.map((r) => [r.id, r]))
      return {
        overall: s.overall,
        cap: s.cap,
        dimensions: s.dimensions,
        not_met: s.requirements
          .filter((r) => r.verdict !== 'met')
          .map((r) => ({ requirement: reqs.get(r.id)?.text, importance: reqs.get(r.id)?.importance, verdict: r.verdict, reason: r.reason })),
        missing_keywords: s.keywords.filter((k) => !k.found).map((k) => k.term),
      }
    },
  },
  {
    name: 'get_letter_rules',
    description: 'How to write a motivation letter for save_motivation_letter (structure, length, salutation and closing in each language). Free.',
    inputSchema: obj({ lang: langSchema }, ['lang']),
    run: async (env, args) => {
      const profile = await db.getSearchProfile(env)
      return {
        rules: letterRules(needLang(args.lang), profile.cvRules),
        candidate_facts: profileFacts(profile) || 'none given: do not state availability, start date or permit',
      }
    },
  },
  {
    name: 'save_motivation_letter',
    description:
      'Saves a motivation letter you wrote for an application (see get_letter_rules). body = salutation, paragraphs separated by blank lines, closing formula; the name, contact details, place and date are printed automatically in the CV style. Returns warnings for numbers or tool names that are not in the material or the posting: fix them and save again. "layout" says whether the printed letter fits on one page; if not, shorten it and save again. When the server has an AI detector, the saved letter is checked right away and ai_check says whether it passes; if not, rewrite it at most once, in natural full sentences, re-read that rewrite for style (stiff or odd wording, filler, lost specifics) and fix it by hand, and keep that version.',
    inputSchema: obj(
      {
        application_id: { type: 'string' },
        lang: langSchema,
        subject: { type: 'string' },
        recipient: { type: 'string', description: 'address block, one line per row (company, contact or department, street and postcode city when published)' },
        body: { type: 'string' },
        notes: { type: 'string', description: 'private notes for the user' },
        enclosures: {
          type: 'string',
          description: 'what is attached, comma-separated, e.g. "Lebenslauf, Immatrikulationsbescheinigung"; "none" for no enclosures line (default: kept from the previous version, else the CV)',
        },
        layout: { type: 'string', enum: [...LETTER_LAYOUTS], description: 'the template: din5008 (German standard, default for German), modern (default otherwise), classic, banner or sidebar; design_letter changes fonts and colours' },
      },
      ['application_id', 'lang', 'subject', 'body'],
    ),
    run: async (env, args, origin) => {
      const app = await needApplication(env, args.application_id)
      const lang = needLang(args.lang)
      const [master, library, linked, profile] = await Promise.all([
        masterResume(env),
        db.getLibrary(env),
        app.resumeId ? db.getResume(env, app.resumeId) : Promise.resolve(null),
        db.getSearchProfile(env),
      ])
      const corpus = [
        corpusOf(master.content[master.sourceLang]!, library),
        linked ? corpusOf(linked.content[linked.sourceLang]!, null) : '',
        profileFacts(profile).toLowerCase(),
      ].join('\n')
      const letter: CoverLetter = {
        subject: str(args.subject, 500),
        recipient: str(args.recipient, 1000),
        body: str(args.body, 20_000).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n'),
        date: new Date().toISOString().slice(0, 10),
        notes: str(args.notes, 5000),
        // Kept from the previous version unless given: the user may have chosen them in the editor.
        // "none" (or "") prints no enclosures line, e.g. for an online form where the CV is uploaded separately.
        enclosures:
          typeof args.enclosures === 'string'
            ? /^(none|-)?$/i.test(args.enclosures.trim())
              ? ''
              : str(args.enclosures, 1000)
            : (app.letters?.[lang]?.enclosures ?? ENCLOSURES[lang].default),
        ...((LETTER_LAYOUTS as readonly unknown[]).includes(args.layout)
          ? { layout: args.layout as LetterLayout }
          : app.letters?.[lang]?.layout
            ? { layout: app.letters[lang]!.layout }
            : {}),
        updatedAt: new Date().toISOString(),
      }
      const warnings = letterIssues(letter, corpus, `${app.title}\n${app.company}\n${app.location}\n${app.description}`)
      if (warnings.length) letter.notes = [letter.notes, `Check before sending: ${warnings.join(', ')} (not found in the material or the posting).`].filter(Boolean).join('\n\n')
      const saved = await saveLetter(env, app, lang, letter)
      return {
        application_id: saved.id,
        language: lang,
        words: letter.body.split(/\s+/).filter(Boolean).length,
        warnings: [
          ...warnings,
          ...gapSentences(letter.body).map((s) => `Points out a missing skill, remove it and save again: "${s}"`),
          ...[fullNameSalutation(letter.body)]
            .filter(Boolean)
            .map((s) => `Salutation uses the full name ("${s}"): write title and surname (Ms/Mr, Frau/Herr) when the posting states the title, otherwise the generic salutation, and save again.`),
        ],
        ai_check: await autoCheck(env, saved, lang, profile.maxAiPercent),
        layout: await letterFitOf(env, origin, saved, lang),
        pdf: await links(env, origin, 'letter', saved.id, lang),
      }
    },
  },
  {
    name: 'design_letter',
    description:
      "Changes how a card's letters look, like the Design panel on the Letters page: the template of one language's letter, and the fonts, colours and spacing that all its letters share. A style field left out keeps its value; whatever was never set follows the linked CV. match_cv: true drops every choice so the letters follow the CV again. Returns each letter's layout: every letter must fit on one page.",
    inputSchema: obj(
      {
        application_id: { type: 'string' },
        lang: { ...langSchema, description: 'the letter whose template changes' },
        template: {
          type: 'string',
          enum: [...LETTER_LAYOUTS],
          description: LETTER_LAYOUTS.map((l) => `${l}: ${LETTER_LAYOUT_DESCRIPTIONS[l]}`).join(' '),
        },
        style: obj({
          font: { type: 'string', enum: [...FONTS] },
          heading_font: { type: 'string', enum: ['', ...FONTS], description: 'font of the name; "" uses the text font' },
          accent: { type: 'string', description: 'hex like "#1e3a52"' },
          text: { type: 'string', description: 'hex' },
          background: { type: 'string', description: 'hex' },
          font_size: { type: 'number', description: `pt, ${LETTER_STYLE_LIMITS.fontSize.join('–')} (DIN 5008 at least 11)` },
          line_height: { type: 'number', description: LETTER_STYLE_LIMITS.lineHeight.join('–') },
          margin_x: { type: 'number', description: `mm, ${LETTER_STYLE_LIMITS.marginX.join('–')} (DIN 5008 keeps its own)` },
          margin_y: { type: 'number', description: `mm, ${LETTER_STYLE_LIMITS.marginY.join('–')} (DIN 5008 keeps its own)` },
          paragraph_gap: { type: 'number', description: `lines between paragraphs, ${LETTER_STYLE_LIMITS.paragraphGap.join('–')}` },
        }),
        match_cv: { type: 'boolean', description: 'forget every style choice: fonts, colours and spacing from the linked CV again' },
      },
      ['application_id'],
    ),
    run: async (env, args, origin) => {
      const app = await needApplication(env, args.application_id)
      const changes: string[] = []
      const problems: string[] = []
      if (args.template !== undefined) {
        const lang = needLang(args.lang)
        const letter = app.letters?.[lang]
        if (!(LETTER_LAYOUTS as readonly unknown[]).includes(args.template)) problems.push(`template must be one of ${LETTER_LAYOUTS.join(', ')}`)
        else if (!letter) problems.push(`the card has no ${LANG_LABELS[lang].name} letter`)
        else {
          app.letters![lang] = { ...letter, layout: args.template as LetterLayout, updatedAt: new Date().toISOString() }
          changes.push(`${lang} template ${args.template}`)
        }
      }
      if (args.match_cv === true) {
        app.letterStyle = {}
        changes.push('style from the CV')
      }
      const given = (args.style ?? {}) as Json
      const named = Object.entries(LETTER_STYLE_NAMES).filter(([k]) => given[k] !== undefined)
      const clean = cleanLetterStyle(Object.fromEntries(named.map(([k, field]) => [field, given[k]])))
      for (const [k, field] of named) {
        if (field in clean) changes.push(k)
        else problems.push(`${k}: ${JSON.stringify(given[k])} is not allowed`)
      }
      if (Object.keys(clean).length) app.letterStyle = { ...app.letterStyle, ...clean }
      if (!changes.length) throw new ToolError(`Nothing to change${problems.length ? `: ${problems.join('; ')}` : ''}.`)

      app.updatedAt = new Date().toISOString()
      await db.putApplication(env, app)
      const langs = LANGS.filter((l) => app.letters?.[l])
      return {
        application_id: app.id,
        changed: changes,
        problems,
        style: letterStyleView(app.letterStyle),
        layout: Object.fromEntries(await Promise.all(langs.map(async (l) => [l, await letterFitOf(env, origin, app, l)] as const))),
      }
    },
  },
  {
    name: 'write_motivation_letter_with_site_ai',
    description: "Writes the motivation letter of an application with the site's model (about $0.002; counts toward the AI budget).",
    inputSchema: obj({ application_id: { type: 'string' }, lang: langSchema }, ['application_id', 'lang']),
    run: async (env, args, origin) => {
      const lang = needLang(args.lang)
      const saved = await letterForApplication(env, await needApplication(env, args.application_id), lang)
      const letter = saved.letters![lang]!
      return { application_id: saved.id, language: lang, subject: letter.subject, body: letter.body, notes: letter.notes, pdf: await links(env, origin, 'letter', saved.id, lang) }
    },
  },
  {
    name: 'check_ai_text',
    description:
      "Runs the site's AI-text detector (free, when the server has one set up) on the CV or the letter of an application in one language, records the result on the card and compares it with the profile's target. If no detector is set up, use one in the browser and record_ai_check.",
    inputSchema: obj({ application_id: { type: 'string' }, doc: docSchema, lang: langSchema }, ['application_id', 'doc', 'lang']),
    run: async (env, args) => {
      const tool = detectorName(env)
      if (!tool) {
        throw new ToolError(
          'No detector is set up on the server. In the browser, check drafts with GPTZero (gptzero.me) and the final version once with Pangram (pangram.com); paste the text (get_application for letters, get_cv for the CV) and save each result with record_ai_check.',
        )
      }
      const app = await needApplication(env, args.application_id)
      const doc = needDoc(args.doc)
      const lang = needLang(args.lang)
      const aiPercent = await detectAi(env, await documentText(env, app, doc, lang))
      await addAiCheck(env, app, { doc, lang, tool, aiPercent, at: new Date().toISOString() })
      const target = (await db.getSearchProfile(env)).maxAiPercent
      return { doc, language: lang, tool, ai_percent: aiPercent, target, passes: aiPercent <= target }
    },
  },
  {
    name: 'record_ai_check',
    description: 'Records the result of an AI-text detector you ran in the browser (GPTZero, Pangram…) on the CV or a letter of an application, shown on the board card.',
    inputSchema: obj(
      {
        application_id: { type: 'string' },
        doc: docSchema,
        lang: langSchema,
        tool: { type: 'string', description: 'detector name, e.g. "GPTZero"' },
        ai_percent: { type: 'number', description: 'share rated AI-written, 0–100, as the detector reports it' },
        note: { type: 'string', description: 'e.g. "after 2 rewrites", "mixed verdict"' },
      },
      ['application_id', 'doc', 'lang', 'tool', 'ai_percent'],
    ),
    run: async (env, args) => {
      const app = await needApplication(env, args.application_id)
      const doc = needDoc(args.doc)
      const lang = needLang(args.lang)
      if (typeof args.ai_percent !== 'number' || !Number.isFinite(args.ai_percent)) throw new ToolError('ai_percent must be a number 0–100')
      const aiPercent = Math.min(100, Math.max(0, Math.round(args.ai_percent)))
      const note = str(args.note, 500)
      const saved = await addAiCheck(env, app, { doc, lang, tool: str(args.tool, 80) || 'detector', aiPercent, at: new Date().toISOString(), ...(note ? { note } : {}) })
      const target = (await db.getSearchProfile(env)).maxAiPercent
      return { recorded: true, ai_percent: aiPercent, target, passes: aiPercent <= target, latest: latestChecks(saved) }
    },
  },
  {
    name: 'read_application_form',
    description:
      'Opens an application form and lists its fields: question, type, required, and the options of choice questions. Greenhouse forms come from their API (also when embedded in a career page with ?gh_jid=); any other public form is opened in a headless browser, which clicks the page\'s Apply / Bewerben button when the form is not on it yet. Pass the apply link or the posting. Returns the URL of the page the form is on: save it as the card\'s apply_url. If found is false or a note says the form needs an account, open it in your browser instead.',
    inputSchema: obj(
      {
        url: { type: 'string', description: 'the application form, or the posting with an Apply button' },
        company: { type: 'string', description: 'company name, helps find the form of a career page on its own domain' },
      },
      ['url'],
    ),
    run: async (env, args) => {
      const url = str(args.url, 2000)
      // LinkedIn shows a sign-in wall instead of the form: go to the company's posting when it can be found.
      let li: URL | null = null
      try {
        li = linkedInJobId(new URL(url)) ? new URL(url) : null
      } catch {
        /* not a link: the reader says so */
      }
      if (li) {
        const page = await readJobPage(env, url, async () => undefined).catch(() => null)
        const apply = page ? await linkedInApply(page) : null
        const target = apply?.same_job_elsewhere?.company_posting
        const form = target ? await readApplicationForm(target, page?.company ?? '', env).catch(() => null) : null
        if (form?.questions.length) {
          return { found: true, ...form, via: 'the same job on the Arbeitsagentur board, which links the company posting', next: "Check that this is the same job, then save url as the card's apply_url and save_form_answers with these questions in this order. Skip name, e-mail, phone and file uploads." }
        }
        return { found: false, apply_on: apply?.apply_on ?? 'unknown', same_job_elsewhere: apply?.same_job_elsewhere ?? null, next: apply?.next ?? "LinkedIn hides the form from signed-out readers: find the posting on the company's careers page and pass that page here." }
      }
      const form = await readApplicationForm(url, str(args.company, 200), env).catch((err: Error) => {
        if (err instanceof AiError) throw err
        console.error('Form reader failed', err)
        return null
      })
      if (!form) return { found: false, next: 'No form fields found (login wall, bot check or an e-mail application): open the Apply button in your browser and read the fields there.' }
      return {
        found: true,
        ...form,
        next: 'Save url as the card\'s apply_url, then save_form_answers with these questions in this order (empty answers on a "saved" card; answers from the CV, knowledge base and search profile when preparing). Skip name, e-mail, phone and file uploads.',
      }
    },
  },
  {
    name: 'save_form_answers',
    description:
      'Saves the answers to the questions of an application form on the card, in the form\'s order, so the user can copy each one into the form. Replaces the saved answers. Contact fields (name, e-mail, phone) and file uploads are not needed. Answers follow the same rules as letters: only facts from the CV, knowledge base and search profile, in the form\'s language, plain text without markdown, and never point out a missing skill or tool. For a choice question, the answer is the exact option to pick. When only the user can answer (salary, start date, citizenship, gender, how they found the job when unknown), leave answer empty or give your suggestion, and say what to decide in note.',
    inputSchema: obj(
      {
        application_id: { type: 'string' },
        apply_url: { type: 'string', description: 'the form, saved as the card\'s apply link' },
        answers: {
          type: 'array',
          items: obj(
            {
              question: { type: 'string', description: 'the question as the form shows it' },
              answer: { type: 'string', description: 'text to paste, or the option to pick' },
              note: { type: 'string', description: 'what the user has to decide or check' },
            },
            ['question', 'answer'],
          ),
        },
      },
      ['application_id', 'answers'],
    ),
    run: async (env, args, origin) => {
      const app = structuredClone(await needApplication(env, args.application_id))
      app.formAnswers = formAnswersField(args.answers)
      if (!app.formAnswers.length) throw new ToolError('answers must be a list of { question, answer, note? }')
      const gaps = app.formAnswers.flatMap((a) => gapSentences(a.answer))
      if (typeof args.apply_url === 'string' && args.apply_url.trim()) app.applyUrl = str(args.apply_url, 2000)
      app.updatedAt = new Date().toISOString()
      await db.putApplication(env, app)
      return {
        saved: app.formAnswers.length,
        warnings: gaps.map((s) => `Points out a missing skill, remove it and save again: "${s}"`),
        to_decide: app.formAnswers.filter((a) => a.note || !a.answer.trim()).map((a) => a.question),
        edit_url: `${origin}/edit/applications/${app.id}`,
      }
    },
  },
  {
    name: 'get_download_links',
    description:
      'PDF download links (valid 6 hours, no login needed) for a CV and/or the motivation letter of an application, to attach to an application form.',
    inputSchema: obj({ resume_id: { type: 'string' }, application_id: { type: 'string' }, lang: langSchema }, ['lang']),
    run: async (env, args, origin) => {
      const lang = needLang(args.lang)
      const out: Json = {}
      let resumeId = str(args.resume_id)
      if (args.application_id) {
        const app = await needApplication(env, args.application_id)
        resumeId ||= app.resumeId ?? ''
        out.letter_pdf = app.letters?.[lang] ? await links(env, origin, 'letter', app.id, lang) : `No ${LANG_LABELS[lang].name} letter yet`
        if (app.letters?.[lang]) {
          const fit = await letterFitOf(env, origin, app, lang)
          if (fit.checked && !fit.ok) out.letter_layout = { ok: false, problems: fit.problems, next: `Not ready to send: shorten the letter first, then get the link again. ${LETTER_FIX}` }
        }
      }
      if (resumeId) {
        const resume = await needResume(env, resumeId)
        out.cv_pdf = resume.content[lang] ? await links(env, origin, 'cv', resume.id, lang) : `This CV has no ${LANG_LABELS[lang].name} version yet`
        if (resume.content[lang] && resume.kind !== 'master') {
          const layout = await layoutOf(env, origin, resume, lang)
          if (layout.checked && !layout.ok)
            out.cv_layout = { ok: false, problems: layout.problems, next: `Not ready to send: fix the layout first (edit_cv), then get the link again. ${LAYOUT_FIX}` }
        }
      }
      if (!Object.keys(out).length) throw new ToolError('Pass resume_id and/or application_id.')
      return out
    },
  },
  {
    name: 'list_applications',
    description: 'The applications board, newest first, optionally filtered by stage or text.',
    inputSchema: obj({ stage: { type: 'string', description: STAGE_HELP }, query: { type: 'string' } }),
    run: async (env, args, origin) => {
      const q = str(args.query).toLowerCase()
      const apps = (await db.listApplications(env)).filter(
        (a) => (!args.stage || a.stage === args.stage) && (!q || `${a.title} ${a.company} ${a.url} ${a.applyUrl ?? ''}`.toLowerCase().includes(q)),
      )
      const columns = await db.getBoardColumns(env)
      return {
        stages: Object.fromEntries(boardStages(columns).map((s) => [s, stageLabel(s, columns)])),
        applications: apps.slice(0, 100).map((a) => applicationSummary(a, origin, columns)),
      }
    },
  },
  {
    name: 'get_application',
    description: 'One card in full: details, fit, the letters (full text), AI-detector history, the CV and the stage history.',
    inputSchema: obj({ id: { type: 'string' } }, ['id']),
    run: async (env, args, origin) => {
      const app = await needApplication(env, args.id)
      const cv = app.resumeId ? await db.getResume(env, app.resumeId) : null
      return {
        ...applicationSummary(app, origin, await db.getBoardColumns(env)),
        notes: app.notes,
        description: app.description.slice(0, 15_000),
        cv: cv ? { id: cv.id, name: cv.name, languages: Object.keys(cv.content), match_score: cv.job?.matchScore ?? null } : null,
        letters: Object.fromEntries(
          LANGS.filter((l) => app.letters?.[l]).map((l) => {
            const letter = app.letters![l]!
            return [l, { subject: letter.subject, recipient: letter.recipient, body: letter.body, notes: letter.notes, template: letterLayoutOf(letter, l), updated: letter.updatedAt }]
          }),
        ),
        letter_style: letterStyleView(app.letterStyle),
        ai_checks: app.aiChecks ?? [],
        form_answers: app.formAnswers ?? [],
        history: app.history,
      }
    },
  },
  {
    name: 'save_application',
    description:
      'Creates a board card (no id) or updates one (id). Stages: saved (bookmarked, nothing prepared), draft (documents prepared, not sent), applied, interview, offer, rejected, or a column the user added (see get_profile board_columns). Moving to applied/interview/offer sets applied_on to today unless given. Only mark "applied" after the user confirmed the application was actually sent.',
    inputSchema: obj({
      id: { type: 'string' },
      title: { type: 'string' },
      company: { type: 'string' },
      url: { type: 'string', description: 'the posting' },
      stage: { type: 'string', description: STAGE_HELP },
      applied_on: { type: 'string', description: 'YYYY-MM-DD' },
      resume_id: { type: 'string', description: 'the CV sent, or to send' },
      cv_language: {
        ...langSchema,
        description:
          'the language to send (CV and letter), shown as "Preferably send in …" on the CV and letter pages: the posting\'s language ("de" for a German posting, "en" for an English one)',
      },
      ...cardSchema,
    }),
    run: async (env, args, origin) => {
      const now = new Date().toISOString()
      const existing = args.id ? await needApplication(env, args.id) : null
      if (!existing && !str(args.title) && !str(args.company)) throw new ToolError('title or company is required for a new card')
      const app: Application = existing ? structuredClone(existing) : newApplication({}, now)
      if (typeof args.title === 'string') app.title = str(args.title)
      if (typeof args.company === 'string') app.company = str(args.company)
      if (typeof args.url === 'string') app.url = str(args.url, 2000)
      applyCardFields(app, args)
      if (typeof args.resume_id === 'string') {
        const resume = await needResume(env, args.resume_id)
        app.resumeId = resume.id
        app.lang = isLang(args.cv_language) && resume.content[args.cv_language] ? args.cv_language : (app.lang ?? resume.sourceLang)
      } else if (isLang(args.cv_language)) app.lang = args.cv_language
      const columns = await db.getBoardColumns(env)
      if (args.stage !== undefined) {
        if (!isStage(args.stage) || !boardStages(columns).includes(args.stage)) {
          throw new ToolError(`stage must be one of ${boardStages(columns).join(', ')}`)
        }
        enterStage(app, args.stage, isDate(args.applied_on) ? str(args.applied_on) : undefined)
      } else if (isDate(args.applied_on)) app.appliedOn = str(args.applied_on)
      await fillLogo(env, app)
      app.updatedAt = now
      await db.putApplication(env, app)
      const other = app.resumeId ? cvAtCompany(await db.listApplications(env), app.company, app.department, app.id) : undefined
      return {
        ...applicationSummary(app, origin, columns),
        warning:
          other && other.resumeId !== app.resumeId
            ? `"${other.title}" at the same company${other.department ? ` (${other.department})` : ''} uses another CV (resume_id "${other.resumeId}"). Use one CV per department unless this one is clearly different.`
            : undefined,
      }
    },
  },
  {
    name: 'delete_application',
    description:
      'Deletes a board card that was not sent (stage saved or draft), e.g. a duplicate. delete_cv: true also deletes its tailored CV when no other card uses it. Sent applications stay on the board as history (move them to "rejected" instead).',
    inputSchema: obj({ id: { type: 'string' }, delete_cv: { type: 'boolean' } }, ['id']),
    run: async (env, args) => {
      const app = await needApplication(env, args.id)
      if (!isUnsent(app.stage)) throw new ToolError(`"${app.title}" is ${stageLabel(app.stage)}: sent applications are kept; set stage "rejected" if it is over.`)
      await db.deleteApplication(env, app.id)
      let cv: string | undefined
      if (args.delete_cv === true && app.resumeId) {
        const resume = await db.getResume(env, app.resumeId)
        const used = (await db.listApplications(env)).some((a) => a.resumeId === app.resumeId)
        if (resume && resume.kind !== 'master' && !used) {
          await db.deleteResume(env, resume.id)
          cv = resume.id
        }
      }
      return { deleted: app.id, title: app.title, company: app.company, deleted_cv: cv ?? null }
    },
  },
  {
    name: 'copy_cv',
    description:
      'Copies a CV (default: the master) into a new general CV without a job and without a board card, e.g. a one-page "Data & ERP" or "DevOps" version to apply with when no tailored CV is needed. Then shape it with edit_cv. languages limits the copy to those languages (the others would go stale when you edit one).',
    inputSchema: obj(
      {
        resume_id: { type: 'string', description: 'CV to copy (default: the master CV)' },
        name: { type: 'string', description: 'name shown in the CV list, e.g. "General – DevOps & Infrastructure"' },
        languages: { type: 'array', items: { type: 'string', enum: [...LANGS] }, description: 'languages to keep (default: all of the source)' },
      },
      ['name'],
    ),
    run: async (env, args, origin) => {
      const source = typeof args.resume_id === 'string' && args.resume_id.trim() ? await db.getResume(env, args.resume_id.trim()) : await masterResume(env)
      if (!source) throw new ToolError(`CV "${String(args.resume_id)}" not found. get_profile lists the CVs.`)
      const now = new Date().toISOString()
      const copy: Resume = { ...structuredClone(source), id: uid('cv'), name: str(args.name, 120) || `${source.name} (copy)`, kind: 'tailored', baseId: source.id, isMain: false, job: null, createdAt: now, updatedAt: now }
      const keep = Array.isArray(args.languages) ? (args.languages as unknown[]).filter(isLang) : []
      if (keep.length) {
        if (!keep.includes(copy.sourceLang)) throw new ToolError(`languages must include the source language (${copy.sourceLang}).`)
        for (const lang of LANGS) {
          if (keep.includes(lang)) continue
          delete copy.content[lang]
          delete copy.translations[lang]
        }
      }
      await db.createResume(env, copy)
      return { resume_id: copy.id, name: copy.name, languages: LANGS.filter((l) => copy.content[l]), layout: await layoutOf(env, origin, copy, copy.sourceLang), next: 'Shape it with edit_cv (headline, summary, items, sections, style) until the layout says "ok".' }
    },
  },
  {
    name: 'delete_cv',
    description:
      'Deletes a tailored CV that no board card uses (the editor lists these as "not on the board yet"), e.g. an old or abandoned one. The master CV and CVs of cards are kept: delete the card first (delete_application) when it was never sent.',
    inputSchema: obj({ resume_id: { type: 'string' } }, ['resume_id']),
    run: async (env, args) => {
      const id = str(args.resume_id, 100)
      const resume = await db.getResume(env, id)
      if (!resume) throw new ToolError(`CV "${id}" not found. get_profile lists the CVs.`)
      if (resume.kind === 'master') throw new ToolError('The master CV is never deleted.')
      const cards = (await db.listApplications(env)).filter((a) => a.resumeId === id)
      if (cards.length) throw new ToolError(`"${resume.name}" belongs to ${cards.map((a) => `"${a.title}" at ${a.company} (${stageLabel(a.stage)})`).join(', ')}: CVs of cards are kept.`)
      await db.deleteResume(env, id)
      return { deleted: id, name: resume.name }
    },
  },
]

/* ------------------------------------------------------------------ */
/* JSON-RPC                                                             */
/* ------------------------------------------------------------------ */

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Json
}

async function dispatch(env: Env, msg: RpcRequest, origin: string): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'sforza', title: 'Sforza', version: '1.1.0' },
        instructions: INSTRUCTIONS,
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
    case 'resources/list':
      return { resources: [] }
    case 'resources/templates/list':
      return { resourceTemplates: [] }
    case 'prompts/list':
      return {
        prompts: CLAUDE_PROMPTS.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.args.map(({ name, description, required }) => ({ name, description, required })),
        })),
      }
    case 'prompts/get': {
      const prompt = CLAUDE_PROMPTS.find((p) => p.name === msg.params?.name)
      if (!prompt) throw Object.assign(new Error(`Unknown prompt: ${String(msg.params?.name)}`), { code: -32602 })
      const given = (msg.params?.arguments ?? {}) as Record<string, unknown>
      const args = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v ?? '').slice(0, 2000)]))
      const missing = prompt.args.find((a) => a.required && !args[a.name]?.trim())
      if (missing) throw Object.assign(new Error(`Missing argument: ${missing.name}`), { code: -32602 })
      return {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.build(await promptContext(env), args) } }],
      }
    }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 })
      try {
        const result = await tool.run(env, (msg.params?.arguments as Json) ?? {}, origin)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }
      } catch (err) {
        // Tool failures go back to the model as results it can act on.
        const known = err instanceof ToolError || err instanceof AiError
        if (!known) console.error(`MCP tool ${name} failed`, err)
        return { content: [{ type: 'text', text: known ? (err as Error).message : `Failed: ${(err as Error).message}` }], isError: true }
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 })
  }
}

export async function handleMcp(c: Ctx, pathToken?: string): Promise<Response> {
  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const user = await connectorUser(c.env, pathToken ?? bearer)
  if (!user) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, { 'X-Robots-Tag': 'noindex' })
  }
  // Stateless server: no server-initiated stream and no sessions to end.
  if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' })

  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }
  const origin = siteOrigin(c.env, c.req.url)
  await db.ensureDb(c.env)
  const env = db.forOwner(c.env, user)
  await db.ensureAccount(env)
  const messages = (Array.isArray(payload) ? payload : [payload]) as RpcRequest[]
  const replies = await Promise.all(
    messages.map(async (msg) => {
      if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
        return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }
      }
      const isNotification = msg.id === undefined || msg.id === null
      try {
        const result = await dispatch(env, msg, origin)
        return isNotification ? null : { jsonrpc: '2.0', id: msg.id, result }
      } catch (err) {
        if (isNotification) return null
        return { jsonrpc: '2.0', id: msg.id, error: { code: (err as { code?: number }).code ?? -32603, message: (err as Error).message } }
      }
    }),
  )
  const out = replies.filter(Boolean)
  if (!out.length) return c.body(null, 202)
  return c.json(Array.isArray(payload) ? out : out[0], 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
}
