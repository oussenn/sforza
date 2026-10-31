import { TEMPLATE_MAP } from '@shared/templates'
import type { AiCheck, Application, CoverLetter, JobAnalysis, JobInfo, Lang, MatchScore, Resume, ResumeContent } from '@shared/types'
import { LANGS } from '@shared/types'
import { clone, contentHash, cvMarkdown, detectorText, isUnsent, jobSource, jobUrlKey, newApplication, profileFacts, uid } from '@shared/utils'
import { AiError, translate } from './ai'
import * as db from './db'
import { writeLetter } from './letter'
import { analyzeJob, scoreCv } from './match'
import { finishTailoring, tailor, type TailorOutput } from './tailor'

/**
 * The CV / letter / application workflows, shared by the editor's API routes and the MCP tools that let an
 * agent (Claude Desktop) run the same pipeline.
 */

export type Progress = (message: string) => Promise<void> | void

export type JobInput = Pick<JobInfo, 'title' | 'company' | 'url' | 'description'>
export type TailorJob = JobInput & { logo?: string; location?: string }

const langName = (l: Lang) => ({ en: 'English', fr: 'French', de: 'German' })[l]

export async function translateInto(env: Env, resume: Resume, targets: Lang[], progress: Progress = () => undefined) {
  const source = resume.content[resume.sourceLang]
  if (!source) throw new AiError('The source language has no content to translate.')
  const hash = contentHash(source)
  const wanted = [...new Set(targets)].filter((l) => l !== resume.sourceLang && LANGS.includes(l))
  if (wanted.length) await progress(`Translating to ${wanted.map(langName).join(' and ')}…`)
  const results = await Promise.all(wanted.map((l) => translate(env, source, resume.sourceLang, l)))
  wanted.forEach((l, i) => {
    resume.content[l] = results[i]
    resume.translations[l] = { sourceHash: hash, at: new Date().toISOString() }
  })
}

/** The stored analysis when it belongs to this posting, otherwise a fresh one. */
export async function analysisFor(env: Env, job: JobInput, analysis?: JobAnalysis | null): Promise<JobAnalysis> {
  if (analysis?.requirements?.length) return analysis
  const text = [job.title, job.description].filter(Boolean).join('\n\n')
  if (text.length < 40) throw new AiError('Add the job description to compute a match score.')
  const { analysis: fresh, rejected } = await analyzeJob(env, { title: job.title, company: job.company, url: job.url, text })
  if (rejected.length) console.warn('Requirements without a quote in the posting were dropped:', rejected)
  if (!fresh.requirements.length) throw new AiError('No requirements found in this job description.')
  return fresh
}

export async function score(env: Env, content: ResumeContent, lang: Lang, analysis: JobAnalysis): Promise<MatchScore> {
  const { unverified, ...result } = await scoreCv(env, content, lang, analysis)
  if (unverified.length) console.warn('Verdicts without evidence on the CV were downgraded:', unverified)
  return result
}

/** Scores a CV against its job and saves the result on the CV. */
export async function rescore(env: Env, resume: Resume, progress: Progress = () => undefined): Promise<Resume> {
  const job = resume.job
  const content = resume.content[resume.sourceLang]
  if (!job) throw new AiError('This CV has no job attached.')
  if (!content) throw new AiError('This CV has no content.')
  await progress(job.analysis ? 'Scoring…' : 'Reading the requirements…')
  const analysis = await analysisFor(env, job, job.analysis)
  await progress('Scoring…')
  const result = await score(env, content, resume.sourceLang, analysis)
  resume.job = { ...job, analysis, score: result, matchScore: result.overall }
  resume.updatedAt = new Date().toISOString()
  await db.saveResume(env, resume)
  return resume
}

/**
 * Puts a new tailored CV on the applications board: on the application it was made for, on a card for the
 * same posting that is not sent yet, or on a new card. Cards with documents ready and not sent are "Draft".
 */
async function trackApplication(
  d1: db.Store,
  resume: Resume,
  job: TailorJob,
  applicationId: string | undefined,
): Promise<Application | null> {
  const now = new Date().toISOString()
  const apps = await db.listApplications(d1)
  const key = job.url ? jobUrlKey(job.url) : ''
  const lower = (s: string) => s.trim().toLowerCase()
  const existing = apps.find((a) =>
    applicationId
      ? a.id === applicationId
      : key
        ? !!a.url && jobUrlKey(a.url) === key
        : !a.url && lower(a.title) === lower(job.title) && lower(a.company) === lower(job.company),
  )
  if (existing) {
    // Once sent, a card keeps the CV that was actually sent.
    if (!applicationId && !isUnsent(existing.stage)) return existing
    const updated: Application = {
      ...existing,
      ...(existing.stage === 'saved'
        ? { stage: 'draft' as const, history: [...existing.history, { stage: 'draft' as const, at: now }], order: -Date.now() }
        : {}),
      resumeId: resume.id,
      lang: existing.lang && resume.content[existing.lang] ? existing.lang : resume.sourceLang,
      logo: existing.logo || job.logo || '',
      location: existing.location || job.location || '',
      description: existing.description || job.description,
      source: existing.source || jobSource(job.url),
      updatedAt: now,
    }
    await db.putApplication(d1, updated)
    return updated
  }
  const created = newApplication(
    {
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.location ?? '',
      logo: job.logo ?? '',
      description: job.description,
      source: jobSource(job.url),
      resumeId: resume.id,
      lang: resume.sourceLang,
      stage: 'draft',
    },
    now,
  )
  await db.putApplication(d1, created)
  return created
}

export async function masterResume(d1: db.Store): Promise<Resume> {
  const list = await db.listResumes(d1)
  const master = list.find((r) => r.kind === 'master') ?? list.find((r) => r.isMain) ?? list[0]
  if (!master) throw new AiError('No master CV yet.')
  return master
}

/** The CV whose name, contacts and style the letter uses: the linked CV, else the master. */
export async function letterCv(d1: db.Store, application: Application): Promise<Resume> {
  return (application.resumeId ? await db.getResume(d1, application.resumeId) : null) ?? (await masterResume(d1))
}

function tailoredResume(base: Resume, job: TailorJob, content: ResumeContent, name: string, notes: string): Resume {
  const now = new Date().toISOString()
  return {
    id: uid('cv'),
    name,
    kind: 'tailored',
    baseId: base.id,
    isMain: false,
    template: base.template,
    style: clone(base.style ?? TEMPLATE_MAP[base.template].style),
    photo: base.photo,
    sourceLang: base.sourceLang,
    content: { [base.sourceLang]: content },
    translations: {},
    job: {
      title: job.title,
      company: job.company,
      url: job.url,
      description: job.description,
      logo: job.logo ?? '',
      location: job.location ?? '',
      notes,
      matchScore: null,
      analysis: null,
      score: null,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export interface TailorOptions {
  base: Resume
  job: TailorJob
  applicationId?: string
  analysis?: JobAnalysis | null
  languages: Lang[]
  useLibrary: boolean
  strict: boolean
  /** also write a motivation letter in this language ('auto': the posting's language) */
  letterLang?: Lang | 'auto' | null
  /** a CV written by an agent instead of the app's model (same format and checks) */
  authored?: TailorOutput
  /** score the result (one model call) */
  scoreIt?: boolean
}

/** Tailors a CV (the app's model, or an agent's answer), scores and translates it, and puts it on the board. */
export async function createTailoredCv(
  env: Env,
  opts: TailorOptions,
  progress: Progress = () => undefined,
): Promise<{ resume: Resume; application: Application | null }> {
  const { base, job } = opts
  const sourceContent = base.content[base.sourceLang]
  if (!sourceContent) throw new AiError('The base CV has no content.')
  const library = opts.useLibrary ? await db.getLibrary(env) : null
  const wantScore = opts.scoreIt !== false

  // The requirements and ATS keywords guide the tailoring and are reused for the score.
  let analysis: Promise<JobAnalysis> | null = null
  if (opts.analysis?.requirements?.length || (!opts.authored && job.description) || wantScore) {
    analysis = analysisFor(env, job, opts.analysis)
    analysis.catch(() => undefined)
  }
  let known: JobAnalysis | null = null
  if (!opts.authored && analysis) {
    await progress('Reading the job posting and picking the best material…')
    known = await analysis.catch((err: unknown) => {
      console.warn('Tailoring without a requirement list:', err)
      return null
    })
    if (!opts.analysis && known) await progress(`Matching ${known.requirements.length} requirements to your material…`)
  } else if (opts.analysis?.requirements?.length) {
    known = opts.analysis
  }

  const result = opts.authored
    ? finishTailoring(sourceContent, library, opts.authored, job, opts.strict, known)
    : await tailor(env, sourceContent, base.sourceLang, library, job, opts.strict, known, { rules: (await db.getSearchProfile(env)).cvRules })
  const resume = tailoredResume(base, job, result.content, result.name, result.notes)

  const scoring =
    wantScore && analysis
      ? (async () => {
          const a = await analysis
          await progress('Scoring the match…')
          return { analysis: a, score: await score(env, result.content, base.sourceLang, a) }
        })()
      : null
  scoring?.catch(() => undefined)
  await translateInto(env, resume, opts.languages ?? [], progress)
  const info = resume.job!
  if (scoring) {
    try {
      const scored = await scoring
      resume.job = {
        ...info,
        location: info.location || scored.analysis.location,
        analysis: scored.analysis,
        score: scored.score,
        matchScore: scored.score.overall,
      }
    } catch (err) {
      console.error('Scoring failed', err)
      info.notes += `\n\nMatch score unavailable: ${(err as Error).message}. Use "Re-score" to retry.`
    }
  }
  await progress('Saving…')
  await db.createResume(env, resume)
  let application = await trackApplication(env, resume, { ...job, location: resume.job?.location }, opts.applicationId).catch((err) => {
    console.error('Could not add the CV to the applications board', err)
    return null
  })

  if (opts.letterLang && application) {
    await progress('Writing the motivation letter…')
    const lang = opts.letterLang === 'auto' ? postingLang(resume.job?.analysis ?? known, base.sourceLang) : opts.letterLang
    application = await letterForApplication(env, application, lang).catch((err: unknown) => {
      console.error('Letter failed', err)
      return application
    })
  }
  return { resume, application }
}

/** Writes (or rewrites) the motivation letter of an application with the app's model and saves it. */
export async function letterForApplication(env: Env, application: Application, lang: Lang): Promise<Application> {
  const [master, library, linked, profile] = await Promise.all([
    masterResume(env),
    db.getLibrary(env),
    application.resumeId ? db.getResume(env, application.resumeId) : Promise.resolve(null),
    db.getSearchProfile(env),
  ])
  const cvResume = linked ?? master
  const cv = cvResume.content[cvResume.sourceLang]
  if (!cv) throw new AiError('The CV of this application has no content.')
  const letter = await writeLetter(env, {
    lang,
    cv,
    master: master.content[master.sourceLang] ?? null,
    library,
    job: {
      title: application.title,
      company: application.company,
      location: application.location,
      description: application.description || linked?.job?.description || '',
    },
    analysis: linked?.job?.analysis ?? null,
    facts: profileFacts(profile),
    rules: profile.cvRules,
  })
  return saveLetter(env, application, lang, letter)
}

export async function saveLetter(d1: db.Store, application: Application, lang: Lang, letter: CoverLetter): Promise<Application> {
  // Re-read so a letter never overwrites edits saved meanwhile.
  const fresh = (await db.getApplication(d1, application.id)) ?? application
  const updated: Application = { ...fresh, letters: { ...fresh.letters, [lang]: letter }, updatedAt: new Date().toISOString() }
  await db.putApplication(d1, updated)
  return updated
}

/** The language a letter for this posting should use: the posting's, when the app supports it. */
function postingLang(analysis: Pick<JobAnalysis, 'language'> | null | undefined, fallback: Lang): Lang {
  const l = analysis?.language?.slice(0, 2).toLowerCase()
  return (LANGS as readonly string[]).includes(l ?? '') ? (l as Lang) : fallback
}

/** The text of an application's CV or letter in one language, as an AI-text detector should read it. */
export async function documentText(d1: db.Store, application: Application, doc: AiCheck['doc'], lang: Lang): Promise<string> {
  if (doc === 'letter') {
    const letter = application.letters?.[lang]
    if (!letter) throw new AiError(`This application has no ${lang.toUpperCase()} letter.`)
    return `${letter.subject}\n\n${letter.body}`
  }
  const resume = application.resumeId ? await db.getResume(d1, application.resumeId) : null
  const content = resume?.content[lang]
  if (!content) throw new AiError(resume ? `This CV has no ${lang.toUpperCase()} version.` : 'This application has no CV.')
  // Name, headline and contact lines are not prose.
  return detectorText(cvMarkdown(content).split('\n').slice(3).join('\n'))
}

/** Adds a detector result to an application (re-read first, so edits saved meanwhile are kept). */
export async function addAiCheck(d1: db.Store, application: Application, check: AiCheck): Promise<Application> {
  const fresh = (await db.getApplication(d1, application.id)) ?? application
  const updated: Application = { ...fresh, aiChecks: [...(fresh.aiChecks ?? []), check].slice(-40), updatedAt: new Date().toISOString() }
  await db.putApplication(d1, updated)
  return updated
}
