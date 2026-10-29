import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { AiCheck, AiEvent, AiStatus, Application, CoverLetter, JobAnalysis, Lang, LetterLayout, Library, Resume, ScrapedJob } from '@shared/types'
import { LANGS, LETTER_LAYOUTS } from '@shared/types'
import { formAnswersField } from './forms'
import {
  cleanBoardColumns,
  cleanLetterStyle,
  cleanSearchProfile,
  clone,
  isStage,
  jobSource,
  letterLayoutOf,
  letterStyleOf,
  newApplication,
  passwordProblem,
  toMeta,
  uid,
  usernameProblem,
} from '@shared/utils'
import { AiError, aiStatus } from './ai'
import { analyzeJob } from './match'
import { findLogo } from './logo'
import { aiSpend } from './budget'
import { detectAi, detectorName } from './detect'
import { decodeEntities, parseJobUrl, readJobPage } from './scrape'
import {
  adminUser,
  checkPrintToken,
  checkShare,
  clearLoginFailures,
  clearSession,
  connectorToken,
  createFirstAccount,
  createInvite,
  hasAccounts,
  isLocalRequest,
  issueSession,
  joinWithInvite,
  listAccounts,
  listInvites,
  loginLocked,
  recordLoginFailure,
  revokeInvite,
  sameSecret,
  secretConfigured,
  sessionUser,
  setLocked,
  setPassword,
  siteOrigin,
  verifyLogin,
} from './auth'
import { PdfError, renderLetterPdf, renderPdf } from './pdf'
import { handleMcp } from './mcp'
import {
  addAiCheck,
  analysisFor,
  createTailoredCv,
  documentText,
  letterCv,
  letterForApplication,
  rescore,
  score,
  translateInto,
  type JobInput,
  type TailorJob,
} from './service'
import * as db from './db'

type App = { Bindings: Env }
type Ctx = Context<App>

const app = new Hono<App>()

// Everything else needs a session. The print and share routes check their own signed token and scope to its account.
const PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/setup',
  '/api/auth/join',
  '/api/print-data',
  '/api/print-letter',
])

// The largest legitimate body is a photo upload (1.5 MB); D1 rows stop at 2 MB anyway.
const limitBody = bodyLimit({ maxSize: 2_500_000, onError: (c) => c.json({ error: 'Request too large' }, 413) })
app.use('/api/*', limitBody)
app.use('/mcp', limitBody)
app.use('/mcp/*', limitBody)

app.use('/api/*', async (c, next) => {
  await db.ensureDb(c.env)
  const path = c.req.path
  // Cookie is SameSite=Strict; writes, sign-in and sign-out included, also need a header no cross-site form can send.
  if (!['GET', 'HEAD'].includes(c.req.method) && !c.req.header('x-requested-with')) {
    return c.json({ error: 'Missing X-Requested-With header' }, 400)
  }
  const isPublic = PUBLIC_API.has(path) || (c.req.method === 'GET' && (path.startsWith('/api/assets/') || path.startsWith('/api/share/')))
  if (!isPublic) {
    const user = await sessionUser(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    // From here on every read and write of this request belongs to this account.
    c.env = db.forOwner(c.env, user)
    await db.ensureAccount(c.env)
  }
  await next()
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
})

/* ---------------------------------- auth --------------------------------- */

const NO_SECRET = 'Set the SESSION_SECRET secret (16+ characters) on the Worker.'

/** The sign-in fields of a request body; anything that is not a string counts as empty. */
async function credentials(c: Ctx) {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const field = (name: string, max: number) => (typeof body[name] === 'string' ? (body[name] as string).slice(0, max) : '')
  return {
    username: field('username', 64).trim().toLowerCase(),
    password: field('password', 257),
    current: field('current', 257),
    code: field('code', 128),
    setupToken: field('setupToken', 256),
  }
}

const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? 'unknown'
const tooMany = (c: Ctx, wait: number) => c.json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` }, 429)
/** Failed attempts answer a little later, which slows guessing down further. */
const slowDown = () => new Promise((r) => setTimeout(r, 700))

app.post('/api/auth/login', async (c) => {
  if (!secretConfigured(c.env)) return c.json({ error: NO_SECRET }, 500)
  const { username, password } = await credentials(c)
  const ip = clientIp(c)
  const wait = await loginLocked(c.env.DB, ip, username)
  if (wait > 0) return tooMany(c, wait)
  const user = await verifyLogin(c.env, username, password.slice(0, 256))
  if (!user) {
    await recordLoginFailure(c.env.DB, ip, username)
    await slowDown()
    return c.json({ error: 'Wrong username or password' }, 401)
  }
  await clearLoginFailures(c.env.DB, ip, user)
  await issueSession(c, user)
  return c.json({ ok: true, user })
})

app.post('/api/auth/logout', (c) => {
  clearSession(c)
  return c.json({ ok: true })
})

/** The signed-in account's MCP connector address (MCP panel); it gives full access to this account. */
app.get('/api/connector', async (c) => {
  const token = await connectorToken(c.env, db.ownerOf(c.env))
  if (!token) return c.json({ error: 'The MCP_TOKEN secret is not set on the Worker.' }, 503)
  return c.json({ url: `${siteOrigin(c.env, c.req.url)}/mcp/${token}` })
})

app.get('/api/auth/me', async (c) => {
  const user = await sessionUser(c)
  // On an old address of this deployment the app moves the visitor to the main one.
  const site = siteOrigin(c.env, c.req.url)
  // A new deployment without any account: the sign-in page offers to create the first one.
  const setup = !user && !(await hasAccounts(c.env)) ? { setup: { needsToken: !isLocalRequest(c.req.url) } } : {}
  return c.json({ authenticated: !!user, user, ...setup, ...(site !== new URL(c.req.url).origin && { moveTo: site }) })
})

/**
 * First-run setup: the first account of a deployment, made in the app. Locally it needs nothing more; on a public
 * address it needs the SETUP_TOKEN secret, so nobody else can claim a new deployment before its owner does.
 */
app.post('/api/auth/setup', async (c) => {
  if (!secretConfigured(c.env)) return c.json({ error: NO_SECRET }, 500)
  const { username, password, setupToken } = await credentials(c)
  const ip = clientIp(c)
  const wait = await loginLocked(c.env.DB, ip, 'setup')
  if (wait > 0) return tooMany(c, wait)
  if (await hasAccounts(c.env)) return c.json({ error: 'This site has an account already. Sign in instead.' }, 403)
  if (!isLocalRequest(c.req.url)) {
    const expected = c.env.SETUP_TOKEN ?? ''
    if (expected.length < 16) return c.json({ error: 'Set the SETUP_TOKEN secret (16+ characters) on the Worker to create the first account.' }, 403)
    if (!(await sameSecret(setupToken, expected))) {
      await recordLoginFailure(c.env.DB, ip, 'setup')
      await slowDown()
      return c.json({ error: 'Wrong setup token' }, 403)
    }
  }
  const problem = usernameProblem(username) ?? passwordProblem(password, username)
  if (problem) return c.json({ error: problem }, 400)
  if (!(await createFirstAccount(c.env, username, password))) return c.json({ error: 'This site has an account already. Sign in instead.' }, 403)
  await clearLoginFailures(c.env.DB, ip, 'setup')
  await issueSession(c, username)
  return c.json({ ok: true, user: username })
})

/** A new account from an invitation link (/join#<code>): the person picks their own username and password. */
app.post('/api/auth/join', async (c) => {
  if (!secretConfigured(c.env)) return c.json({ error: NO_SECRET }, 500)
  const { username, password, code } = await credentials(c)
  const ip = clientIp(c)
  const wait = await loginLocked(c.env.DB, ip, 'join')
  if (wait > 0) return tooMany(c, wait)
  const problem = usernameProblem(username) ?? passwordProblem(password, username)
  if (problem) return c.json({ error: problem }, 400)
  const result = code ? await joinWithInvite(c.env, code, username, password) : 'invalid'
  if (result === 'invalid') {
    await recordLoginFailure(c.env.DB, ip, 'join')
    await slowDown()
    return c.json({ error: 'This invitation is not valid. It may have expired or been used already.' }, 403)
  }
  if (result === 'taken') return c.json({ error: 'That username is taken. Pick another one.' }, 409)
  await issueSession(c, username)
  return c.json({ ok: true, user: username })
})

/** A new password for the signed-in account. Every other session and signed link of the account stops working. */
app.post('/api/auth/password', async (c) => {
  const user = db.ownerOf(c.env)
  const { current, password } = await credentials(c)
  const ip = clientIp(c)
  const wait = await loginLocked(c.env.DB, ip, user)
  if (wait > 0) return tooMany(c, wait)
  if (!(await verifyLogin(c.env, user, current.slice(0, 256)))) {
    await recordLoginFailure(c.env.DB, ip, user)
    await slowDown()
    return c.json({ error: 'The current password is wrong' }, 403)
  }
  const problem = passwordProblem(password, user) ?? (password === current ? 'Choose a password you have not used here.' : null)
  if (problem) return c.json({ error: problem }, 400)
  await setPassword(c.env, user, password)
  await clearLoginFailures(c.env.DB, ip, user)
  // This browser stays signed in with a session for the new password.
  await issueSession(c, user)
  return c.json({ ok: true })
})

/* -------------------------------- accounts -------------------------------- */

const ADMIN_ONLY = 'Only the admin account can manage accounts.'
const isAdmin = async (c: Ctx) => (await adminUser(c.env)) === db.ownerOf(c.env)

app.get('/api/accounts', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: ADMIN_ONLY }, 403)
  return c.json({ accounts: await listAccounts(c.env), invites: await listInvites(c.env) })
})

/** A one-time invitation link, valid for 7 days. The code is in the #fragment, which browsers never send to a server. */
app.post('/api/accounts/invites', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: ADMIN_ONLY }, 403)
  const { code, expiresAt } = await createInvite(c.env, db.ownerOf(c.env))
  return c.json({ url: `${siteOrigin(c.env, c.req.url)}/join#${code}`, expiresAt })
})

app.delete('/api/accounts/invites/:id', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: ADMIN_ONLY }, 403)
  return (await revokeInvite(c.env, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404)
})

/** Locks or unlocks another account. Its data stays, and so does its username. */
app.put('/api/accounts/:username/access', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: ADMIN_ONLY }, 403)
  const username = c.req.param('username').toLowerCase()
  if (username === db.ownerOf(c.env)) return c.json({ error: 'You cannot lock your own account.' }, 400)
  const body = await c.req.json<{ disabled?: unknown }>().catch(() => ({}) as { disabled?: unknown })
  if (typeof body.disabled !== 'boolean') return c.json({ error: 'Send { "disabled": true } or false' }, 400)
  return (await setLocked(c.env, username, body.disabled)) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404)
})

/* ---------------------------------- PDFs --------------------------------- */

const pickLang = (resume: Resume, wanted: string | undefined): Lang =>
  wanted && (LANGS as readonly string[]).includes(wanted) && resume.content[wanted as Lang] ? (wanted as Lang) : resume.sourceLang

async function pdfResponse(c: Ctx, resume: Resume) {
  try {
    return await renderPdf(c.env, new URL(c.req.url).origin, resume, pickLang(resume, c.req.query('lang')))
  } catch (err) {
    console.error('PDF rendering failed', err)
    return c.json({ error: 'PDF rendering is unavailable right now' }, 502)
  }
}

/** PDF of the signed-in account's main CV. */
app.get('/api/pdf', async (c) => {
  const resume = await db.getMainResume(c.env)
  return resume ? pdfResponse(c, resume) : c.json({ error: 'No resume yet' }, 404)
})

/** Data for the headless /print page; authorised by a short-lived signed token. */
app.get('/api/print-data', async (c) => {
  const id = c.req.query('id') ?? ''
  const owner = await checkPrintToken(c.env, id, c.req.query('token'))
  if (!owner) return c.json({ error: 'Print token rejected' }, 403)
  const resume = await db.getResume(db.forOwner(c.env, owner), id)
  return resume ? c.json({ ...resume, job: null, translations: {} } satisfies Resume) : c.json({ error: 'Not found' }, 404)
})

app.get('/api/assets/:id', async (c) => {
  const asset = await db.getAsset(c.env, c.req.param('id'))
  if (!asset) return c.notFound()
  const bytes = Uint8Array.from(atob(asset.data), (ch) => ch.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      'Content-Type': asset.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
      // Fetched logos can be SVG: never let one run scripts on this origin.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
})

app.post('/api/assets', async (c) => {
  const mime = c.req.header('content-type') ?? ''
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return c.json({ error: 'Only JPEG, PNG or WebP images' }, 415)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > 1_500_000) return c.json({ error: 'Image too large (max 1.5 MB)' }, 413)
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const id = uid('img')
  await db.putAsset(c.env, id, mime, btoa(bin))
  return c.json({ url: `/api/assets/${id}` })
})

/* --------------------------------- resumes ------------------------------- */

app.get('/api/resumes', async (c) => {
  const resumes = await db.listResumes(c.env)
  return c.json(resumes.map(toMeta))
})

app.get('/api/resumes/:id', async (c) => {
  const resume = await db.getResume(c.env, c.req.param('id'))
  return resume ? c.json(resume) : c.json({ error: 'Not found' }, 404)
})

app.post('/api/resumes', async (c) => {
  const body = await c.req.json<{ duplicateOf?: string; name?: string; blank?: boolean }>()
  const now = new Date().toISOString()
  const source = body.duplicateOf ? await db.getResume(c.env, body.duplicateOf) : await db.getMainResume(c.env)
  if (!source) return c.json({ error: 'Source resume not found' }, 404)
  const resume: Resume = {
    ...clone(source),
    id: uid('cv'),
    name: body.name?.trim() || `${source.name} (copy)`,
    kind: 'tailored',
    baseId: source.id,
    isMain: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.createResume(c.env, resume)
  return c.json(resume, 201)
})

app.put('/api/resumes/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await db.getResume(c.env, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const incoming = await c.req.json<Resume>()
  const resume: Resume = {
    ...incoming,
    id,
    kind: existing.kind,
    isMain: existing.isMain,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }
  await db.saveResume(c.env, resume)
  return c.json({ updatedAt: resume.updatedAt })
})

app.delete('/api/resumes/:id', async (c) => {
  const resume = await db.getResume(c.env, c.req.param('id'))
  if (!resume) return c.json({ error: 'Not found' }, 404)
  if (resume.kind === 'master') return c.json({ error: 'The master CV cannot be deleted' }, 400)
  if (resume.isMain) return c.json({ error: 'Mark another CV as main before deleting this one' }, 400)
  await db.deleteResume(c.env, resume.id)
  return c.json({ ok: true })
})

/** PDF of any CV (editor download). */
app.get('/api/pdf/:id', async (c) => {
  const resume = await db.getResume(c.env, c.req.param('id'))
  return resume ? pdfResponse(c, resume) : c.json({ error: 'Not found' }, 404)
})

app.post('/api/resumes/:id/main', async (c) => {
  const resume = await db.getResume(c.env, c.req.param('id'))
  if (!resume) return c.json({ error: 'Not found' }, 404)
  await db.setMain(c.env, resume.id)
  return c.json({ ok: true })
})

/* --------------------------------- library ------------------------------- */

app.get('/api/library', async (c) => c.json(await db.getLibrary(c.env)))

app.put('/api/library', async (c) => {
  const lib = await c.req.json<Library>()
  await db.saveLibrary(c.env, lib)
  return c.json({ ok: true })
})

/* ------------------------------ search profile ---------------------------- */

app.get('/api/search-profile', async (c) => c.json(await db.getSearchProfile(c.env)))

app.put('/api/search-profile', async (c) => {
  const profile = cleanSearchProfile(await c.req.json(), await db.getSearchProfile(c.env))
  profile.updatedAt = new Date().toISOString()
  await db.saveSearchProfile(c.env, profile)
  return c.json(profile)
})

/* ------------------------------------ AI ---------------------------------- */

app.get('/api/ai/status', async (c) => {
  const status = aiStatus(c.env)
  const paid = status.provider === 'openai' || status.provider === 'anthropic'
  return c.json({ ...status, spend: paid ? await aiSpend(c.env) : null, detector: detectorName(c.env) } satisfies AiStatus)
})

/** Streams newline-delimited JSON progress events so long AI calls keep the connection alive. */
function streamEvents(c: Ctx, run: (emit: (e: AiEvent) => Promise<void>) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  let open = true
  const emit = async (event: AiEvent) => {
    if (!open) return
    try {
      await writer.write(encoder.encode(JSON.stringify(event) + '\n'))
    } catch {
      open = false
    }
  }
  const ping = setInterval(() => void emit({ type: 'ping' }), 10_000)
  const task = run(emit)
    .catch((err: unknown) => {
      console.error('AI task failed', err)
      // AI and PDF errors are written for the user; anything else stays in the logs.
      const message = err instanceof AiError || err instanceof PdfError ? err.message : 'Something went wrong. Try again.'
      return emit({ type: 'error', message })
    })
    .finally(async () => {
      clearInterval(ping)
      open = false
      await writer.close().catch(() => {})
    })
  c.executionCtx.waitUntil(task)
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

/** Reads a job ad from a link: title, company, description and the requirements. */
app.post('/api/ai/job-from-url', async (c) => {
  const body = await c.req.json<{ url?: string }>()
  const url = body.url?.trim()
  if (!url) return c.json({ error: 'Paste a link first' }, 400)
  return streamEvents(c, async (emit) => {
    await emit({ type: 'progress', message: 'Reading the page…' })
    const page = await readJobPage(c.env, url, (message) => emit({ type: 'progress', message }))
    await emit({ type: 'progress', message: 'Extracting title and requirements…' })
    const logo = findLogo(c.env, page.url, page.html)
    const { analysis, adText } = await analyzeJob(c.env, { title: page.title, company: page.company, url: page.url, text: page.description })
    if (!analysis.requirements.length) {
      throw new AiError('No job requirements found on that page. If the ad is still online, paste its text instead.')
    }
    const job: ScrapedJob = {
      url: page.url,
      title: analysis.title || page.title,
      company: analysis.company || page.company,
      location: analysis.location || page.location,
      description: page.clean ? page.description : (adText ?? page.description.slice(0, 15_000)),
      logo: await logo,
      source: page.source,
    }
    await emit({ type: 'result', result: { job, analysis } })
  })
})

/** Match score of an existing CV against a posting, without saving anything. */
app.post('/api/ai/match', async (c) => {
  const body = await c.req.json<{ resumeId: string; job: JobInput; analysis?: JobAnalysis | null }>()
  const resume = await db.getResume(c.env, body.resumeId)
  if (!resume) return c.json({ error: 'CV not found' }, 404)
  const content = resume.content[resume.sourceLang]
  if (!content) return c.json({ error: 'This CV has no content' }, 400)
  return streamEvents(c, async (emit) => {
    await emit({ type: 'progress', message: body.analysis ? 'Scoring…' : 'Reading the requirements…' })
    const analysis = await analysisFor(c.env, body.job, body.analysis)
    await emit({ type: 'progress', message: 'Scoring…' })
    await emit({ type: 'result', result: { analysis, score: await score(c.env, content, resume.sourceLang, analysis) } })
  })
})

/** Re-scores a tailored CV (after edits) and saves the result. */
app.post('/api/ai/rescore', async (c) => {
  const body = await c.req.json<{ id: string; description?: unknown }>()
  const resume = await db.getResume(c.env, body.id)
  if (!resume?.job) return c.json({ error: 'This CV has no job attached' }, 400)
  // A CV saved without the posting's text takes it from its board card.
  if (!resume.job.description?.trim() && typeof body.description === 'string') resume.job.description = body.description.slice(0, 40_000)
  if (!resume.content[resume.sourceLang]) return c.json({ error: 'This CV has no content' }, 400)
  return streamEvents(c, async (emit) => {
    await emit({ type: 'done', resume: await rescore(c.env, resume, (message) => emit({ type: 'progress', message })) })
  })
})

app.post('/api/ai/tailor', async (c) => {
  const body = await c.req.json<{
    baseId: string
    job: TailorJob
    /** the board card this CV is made for */
    applicationId?: string
    /** from the link reader or a match check, when the posting did not change since */
    analysis?: JobAnalysis | null
    languages: Lang[]
    useLibrary: boolean
    /** keep the original wording of bullets/projects (default) */
    strict?: boolean
    /** also write a motivation letter in the posting's language */
    letter?: boolean
  }>()
  if (!body.job?.title?.trim()) return c.json({ error: 'A job title is required' }, 400)
  const base = await db.getResume(c.env, body.baseId)
  if (!base) return c.json({ error: 'Base resume not found' }, 404)
  if (!base.content[base.sourceLang]) return c.json({ error: 'Base resume has no content' }, 400)

  return streamEvents(c, async (emit) => {
    const progress = (message: string) => emit({ type: 'progress', message })
    const { resume } = await createTailoredCv(
      c.env,
      {
        base,
        job: body.job,
        applicationId: body.applicationId,
        analysis: body.analysis,
        languages: body.languages ?? [],
        useLibrary: body.useLibrary,
        strict: body.strict !== false,
        letterLang: body.letter ? 'auto' : null,
      },
      progress,
    )
    await emit({ type: 'done', resume })
  })
})

app.post('/api/ai/translate', async (c) => {
  const body = await c.req.json<{ id: string; targets: Lang[] }>()
  const resume = await db.getResume(c.env, body.id)
  if (!resume) return c.json({ error: 'Not found' }, 404)
  return streamEvents(c, async (emit) => {
    await translateInto(c.env, resume, body.targets ?? [], (message) => emit({ type: 'progress', message }))
    resume.updatedAt = new Date().toISOString()
    await db.saveResume(c.env, resume)
    await emit({ type: 'done', resume })
  })
})

/* ------------------------------ applications ------------------------------ */

const TEXT_FIELDS = [
  'title', 'company', 'logo', 'url', 'location', 'salary', 'appliedOn', 'nextStep', 'nextDate', 'contact', 'notes', 'description', 'source',
  'applyUrl', 'contactEmail', 'german', 'employment', 'workMode', 'deadline', 'postedOn', 'department',
] as const

/** Detector results from untrusted input. */
function aiChecksField(value: unknown): AiCheck[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .filter((v) => (v.doc === 'cv' || v.doc === 'letter') && isLang(v.lang) && typeof v.aiPercent === 'number' && Number.isFinite(v.aiPercent))
    .map((v) => ({
      doc: v.doc as AiCheck['doc'],
      lang: v.lang as Lang,
      tool: typeof v.tool === 'string' ? v.tool.slice(0, 80) : '',
      aiPercent: Math.min(100, Math.max(0, Math.round(v.aiPercent as number))),
      at: typeof v.at === 'string' ? v.at.slice(0, 40) : new Date().toISOString(),
      ...(typeof v.note === 'string' && v.note ? { note: v.note.slice(0, 500) } : {}),
    }))
    .slice(-40)
}

function letterField(value: unknown): CoverLetter | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const str = (k: string, max = 20_000) => (typeof v[k] === 'string' ? (v[k] as string).slice(0, max) : '')
  return {
    subject: str('subject', 500),
    recipient: str('recipient', 1000),
    body: str('body'),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str('date')) ? str('date') : new Date().toISOString().slice(0, 10),
    notes: str('notes', 5000),
    ...((LETTER_LAYOUTS as readonly unknown[]).includes(v.layout) ? { layout: v.layout as LetterLayout } : {}),
    ...(str('enclosures', 1000) ? { enclosures: str('enclosures', 1000) } : {}),
    updatedAt: str('updatedAt', 40) || new Date().toISOString(),
  }
}

/** The editable fields of an application, type-checked. */
function applicationFields(body: Record<string, unknown>): Partial<Application> {
  const out: Partial<Application> = {}
  for (const key of TEXT_FIELDS) {
    const value = body[key]
    if (typeof value === 'string') out[key] = value.slice(0, key === 'description' || key === 'notes' ? 60_000 : 2_000)
  }
  if (isStage(body.stage)) out.stage = body.stage
  if (typeof body.order === 'number' && Number.isFinite(body.order)) out.order = body.order
  if (body.resumeId === null || typeof body.resumeId === 'string') out.resumeId = body.resumeId
  if (body.lang === null || (LANGS as readonly unknown[]).includes(body.lang)) out.lang = body.lang as Lang | null
  if (body.fit === null) out.fit = null
  else if (body.fit && typeof body.fit === 'object') {
    const fit = body.fit as Record<string, unknown>
    out.fit = {
      score: typeof fit.score === 'number' && Number.isFinite(fit.score) ? Math.min(100, Math.max(0, Math.round(fit.score))) : null,
      summary: typeof fit.summary === 'string' ? fit.summary.slice(0, 2000) : '',
    }
  }
  if (Array.isArray(body.aiChecks)) out.aiChecks = aiChecksField(body.aiChecks)
  if (Array.isArray(body.formAnswers)) out.formAnswers = formAnswersField(body.formAnswers)
  // null or {} (the panel's "Match the CV") lets every letter follow the CV again
  if (body.letterStyle !== undefined) out.letterStyle = cleanLetterStyle(body.letterStyle)
  if (body.letters && typeof body.letters === 'object') {
    const letters: Partial<Record<Lang, CoverLetter>> = {}
    for (const l of LANGS) {
      const letter = letterField((body.letters as Record<string, unknown>)[l])
      if (letter) letters[l] = letter
    }
    out.letters = letters
  }
  if (Array.isArray(body.history)) {
    out.history = (body.history as Application['history'])
      .filter((h) => h && isStage(h.stage) && typeof h.at === 'string')
      .slice(-100)
  }
  return out
}

app.get('/api/applications', async (c) => c.json(await db.listApplications(c.env)))

/** Columns the account added to the board. Cards keep their stage when a column is removed; the board shows them in the stage it followed. */
app.get('/api/board-columns', async (c) => c.json(await db.getBoardColumns(c.env)))

app.put('/api/board-columns', async (c) => {
  const body = await c.req.json<{ columns?: unknown }>().catch(() => ({}) as { columns?: unknown })
  const columns = cleanBoardColumns(body.columns)
  await db.saveBoardColumns(c.env, columns)
  return c.json(columns)
})

app.post('/api/applications', async (c) => {
  const fields = applicationFields(await c.req.json())
  const application = newApplication({ ...fields, source: fields.source || jobSource(fields.url ?? '') }, new Date().toISOString())
  await db.putApplication(c.env, application)
  return c.json(application, 201)
})

app.put('/api/applications/:id', async (c) => {
  const existing = await db.getApplication(c.env, c.req.param('id'))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const application: Application = {
    ...existing,
    ...applicationFields(await c.req.json()),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }
  await db.putApplication(c.env, application)
  return c.json({ updatedAt: application.updatedAt })
})

app.delete('/api/applications/:id', async (c) => {
  await db.deleteApplication(c.env, c.req.param('id'))
  return c.json({ ok: true })
})

const metaContent = (html: string, property: string) =>
  decodeEntities(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1] ?? '').trim()

/** Title, company, location and logo of a job link, read without AI. */
app.post('/api/applications/read-link', async (c) => {
  const { url } = await c.req.json<{ url?: string }>()
  if (!url?.trim()) return c.json({ error: 'Paste a link first' }, 400)
  try {
    const page = await readJobPage(c.env, url, async () => undefined)
    const html = page.html ?? ''
    const job: ScrapedJob = {
      url: page.url,
      // Pages without structured data: their sharing title and site name are the best guess.
      title: page.clean ? page.title : metaContent(html, 'og:title') || page.title,
      company: page.company || metaContent(html, 'og:site_name'),
      location: page.location,
      description: page.clean ? page.description : '',
      logo: await findLogo(c.env, page.url, page.html),
      source: page.source,
    }
    return c.json(job)
  } catch (err) {
    if (err instanceof AiError) return c.json({ error: err.message }, 422)
    throw err
  }
})

/** Looks up the company logo of an application from its job link and saves it. */
app.post('/api/applications/:id/logo', async (c) => {
  const application = await db.getApplication(c.env, c.req.param('id'))
  if (!application) return c.json({ error: 'Not found' }, 404)
  let url: URL
  try {
    url = parseJobUrl(application.url)
  } catch {
    return c.json({ error: 'Add the job link first' }, 400)
  }
  const logo = await findLogo(c.env, url.toString())
  if (!logo) return c.json({ error: 'No logo found on that page. Upload one instead.' }, 404)
  const updated: Application = { ...application, logo, updatedAt: new Date().toISOString() }
  await db.putApplication(c.env, updated)
  return c.json(updated)
})

/** Adds the tailored CVs that are not on the board yet as "Saved" cards. */
app.post('/api/applications/import', async (c) => {
  const [resumes, apps] = await Promise.all([db.listResumes(c.env), db.listApplications(c.env)])
  const linked = new Set(apps.map((a) => a.resumeId))
  const now = new Date().toISOString()
  const created = resumes
    .filter((r) => r.kind === 'tailored' && r.job?.title && !linked.has(r.id))
    .map((r) => {
      const job = r.job!
      const application = newApplication(
        {
          title: job.title,
          company: job.company,
          url: job.url,
          location: job.location || job.analysis?.location || '',
          logo: job.logo ?? '',
          description: job.description,
          resumeId: r.id,
          lang: r.sourceLang,
        },
        now,
      )
      return { ...application, order: -Date.parse(r.createdAt), createdAt: r.createdAt, history: [{ stage: application.stage, at: r.createdAt }] }
    })
  await Promise.all(created.map((a) => db.putApplication(c.env, a)))
  return c.json(await db.listApplications(c.env))
})

/* --------------------------------- letters -------------------------------- */

const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v)

/** Writes the motivation letter of an application with the app's model (one call, about $0.002). */
app.post('/api/ai/letter', async (c) => {
  const body = await c.req.json<{ applicationId: string; lang: Lang }>()
  const application = await db.getApplication(c.env, body.applicationId)
  if (!application) return c.json({ error: 'Application not found' }, 404)
  if (!isLang(body.lang)) return c.json({ error: 'Unsupported language' }, 400)
  return streamEvents(c, async (emit) => {
    await emit({ type: 'progress', message: 'Writing the letter…' })
    await emit({ type: 'result', result: await letterForApplication(c.env, application, body.lang) })
  })
})

/** Runs the server's AI-text detector on the CV or a letter of an application and records the result. */
app.post('/api/applications/:id/ai-check', async (c) => {
  const application = await db.getApplication(c.env, c.req.param('id'))
  if (!application) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ doc?: string; lang?: string }>()
  if ((body.doc !== 'cv' && body.doc !== 'letter') || !isLang(body.lang)) return c.json({ error: 'Pass doc (cv or letter) and lang' }, 400)
  const tool = detectorName(c.env)
  if (!tool) return c.json({ error: 'No AI detector is set up (AIORNOT_API_KEY).' }, 400)
  try {
    const aiPercent = await detectAi(c.env, await documentText(c.env, application, body.doc, body.lang))
    return c.json(await addAiCheck(c.env, application, { doc: body.doc, lang: body.lang, tool, aiPercent, at: new Date().toISOString() }))
  } catch (err) {
    if (err instanceof AiError) return c.json({ error: err.message }, 422)
    throw err
  }
})

async function letterPdfResponse(c: Ctx, application: Application, lang: Lang) {
  try {
    return await renderLetterPdf(c.env, new URL(c.req.url).origin, application, await letterCv(c.env, application), lang)
  } catch (err) {
    console.error('Letter PDF failed', err)
    return c.json({ error: (err as Error).message || 'PDF rendering is unavailable right now' }, 502)
  }
}

app.get('/api/applications/:id/letter.pdf', async (c) => {
  const application = await db.getApplication(c.env, c.req.param('id'))
  const lang = c.req.query('lang')
  if (!application || !isLang(lang) || !application.letters?.[lang]) return c.json({ error: 'No letter in that language' }, 404)
  return letterPdfResponse(c, application, lang)
})

/** Data for the headless /print page of a letter; authorised by a short-lived signed token. */
app.get('/api/print-letter', async (c) => {
  const id = c.req.query('id') ?? ''
  const lang = c.req.query('lang')
  const owner = await checkPrintToken(c.env, `letter:${id}`, c.req.query('token'))
  if (!owner) return c.json({ error: 'Print token rejected' }, 403)
  const env = db.forOwner(c.env, owner)
  const application = await db.getApplication(env, id)
  const letter = isLang(lang) ? application?.letters?.[lang] : undefined
  if (!application || !letter || !isLang(lang)) return c.json({ error: 'Not found' }, 404)
  const cv = await letterCv(env, application)
  const content = cv.content[lang] ?? cv.content[cv.sourceLang]!
  const style = letterStyleOf(cv.style, application.letterStyle, letterLayoutOf(letter, lang))
  return c.json({ letter, lang, personal: content.personal, style, title: application.title })
})

/** Signed download links handed to an agent: /api/share/cv/<id>?lang=de&t=… and /api/share/letter/<id>?lang=de&t=… */
app.get('/api/share/:kind/:id', async (c) => {
  const kind = c.req.param('kind')
  const id = c.req.param('id')
  const lang = c.req.query('lang') ?? ''
  const owner = isLang(lang) ? await checkShare(c.env, kind, id, lang, c.req.query('t')) : null
  if (!owner || !isLang(lang)) return c.json({ error: 'This link is invalid or expired' }, 403)
  c.env = db.forOwner(c.env, owner)
  if (kind === 'cv') {
    const resume = await db.getResume(c.env, id)
    return resume ? pdfResponse(c, resume) : c.json({ error: 'Not found' }, 404)
  }
  if (kind === 'letter') {
    const application = await db.getApplication(c.env, id)
    if (!application?.letters?.[lang]) return c.json({ error: 'No letter in that language' }, 404)
    return letterPdfResponse(c, application, lang)
  }
  return c.json({ error: 'Not found' }, 404)
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

/* ------------------------------ MCP (agents) ------------------------------ */

// Claude Desktop / claude.ai connector: https://<host>/mcp/<MCP_TOKEN>, or /mcp with "Authorization: Bearer <MCP_TOKEN>".
app.all('/mcp', (c) => handleMcp(c))
app.all('/mcp/:token', (c) => handleMcp(c, c.req.param('token')))

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  if (err instanceof SyntaxError) return c.json({ error: 'The request body is not valid JSON' }, 400)
  console.error(err)
  // AI and PDF errors are written for the user; database and other internals stay in the logs.
  return c.json({ error: err instanceof AiError || err instanceof PdfError ? err.message : 'Internal error' }, 500)
})

/** The MCP endpoint needs no OAuth (the token is in the URL): say so to connectors that look for it. */
app.all('/.well-known/*', (c) => c.json({ error: 'Not found' }, 404))

export default app
