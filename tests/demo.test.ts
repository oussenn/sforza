import { beforeAll, describe, expect, it } from 'vitest'
import app from '../worker/index'
import { purgeExpired } from '../worker/demo'
import { usernameProblem } from '@shared/utils'
import { memoryD1 } from './d1'

// The public demo: every sign-in as "demo" gets its own sandbox of sample data, cut off from real accounts and from
// other visitors, limited to the editor and the board, and deleted when it runs out.

const LOCAL = 'http://localhost:5173'
const DEMO_PW = 'try-the-demo-2026'
const OWNER_PW = 'purple otter lantern 42'

let env: Env
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext
let ipCounter = 0

interface Call {
  method?: string
  json?: unknown
  body?: string
  cookie?: string
  ip?: string
  env?: Env
}

function call(path: string, { method = 'GET', json, body, cookie, ip, env: e = env }: Call = {}) {
  const headers = new Headers({ 'X-Requested-With': 'fetch', 'cf-connecting-ip': ip ?? `198.51.100.${++ipCounter}` })
  if (cookie) headers.set('Cookie', cookie)
  if (json !== undefined || body !== undefined) headers.set('Content-Type', 'application/json')
  return app.request(`${LOCAL}${path}`, { method, headers, body: body ?? (json === undefined ? undefined : JSON.stringify(json)) }, e, ctx)
}

const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(/rs_session=[^;]+/)?.[0] ?? ''
const demoLogin = (ip?: string, password = DEMO_PW) => call('/api/auth/login', { method: 'POST', json: { username: 'demo', password }, ip })
const json = <T>(res: Response) => res.json() as Promise<T>
const ownerOf = (cookie: string) => cookie.split('=')[1].split('.')[0]

let real = ''

beforeAll(async () => {
  env = { DB: memoryD1(), SESSION_SECRET: 'test-session-secret-0123456789', DEMO_PASSWORD: DEMO_PW } as unknown as Env
  const res = await call('/api/auth/setup', { method: 'POST', json: { username: 'owner', password: OWNER_PW } })
  expect(res.status).toBe(200)
  real = cookieOf(res)
  await call('/api/applications', { method: 'POST', cookie: real, json: { title: 'Real job', company: 'Real Co' } })
})

describe('signing in to the demo', () => {
  it('is mentioned on the sign-in page only when DEMO_PASSWORD is set', async () => {
    expect(await json(await call('/api/auth/me'))).toMatchObject({ authenticated: false, demoAvailable: true })
    const off = { ...env, DEMO_PASSWORD: undefined } as unknown as Env
    expect(await json(await call('/api/auth/me', { env: off }))).not.toHaveProperty('demoAvailable')
  })

  it('opens a sandbox of sample data that ends in two hours', async () => {
    const res = await demoLogin()
    expect(res.status).toBe(200)
    const cookie = cookieOf(res)
    expect(ownerOf(cookie)).toMatch(/^demo~[a-z0-9]{24}$/)
    const me = await json<{ user: string; demo: { expiresAt: number } }>(await call('/api/auth/me', { cookie }))
    expect(me.user).toBe('demo')
    expect(me.demo.expiresAt - Date.now() / 1000).toBeGreaterThan(7100)
    const resumes = await json<{ id: string; baseId: string | null; kind: string }[]>(await call('/api/resumes', { cookie }))
    const apps = await json<{ title: string; resumeId: string | null }[]>(await call('/api/applications', { cookie }))
    expect(resumes).toHaveLength(2)
    expect(apps).toHaveLength(10)
    // Record ids are the sandbox's own, and the links between them still hold.
    const master = resumes.find((r) => r.kind === 'master')!
    const tailored = resumes.find((r) => r.kind === 'tailored')!
    expect(tailored.baseId).toBe(master.id)
    expect(apps.find((a) => a.resumeId)?.resumeId).toBe(tailored.id)
    expect(apps.map((a) => a.title)).not.toContain('Real job')
  })

  it('keeps every visitor apart from the others and from real accounts', async () => {
    const a = cookieOf(await demoLogin())
    const b = cookieOf(await demoLogin())
    expect(ownerOf(a)).not.toBe(ownerOf(b))
    const appsA = await json<{ id: string }[]>(await call('/api/applications', { cookie: a }))
    // B cannot read, change or delete A's card, and A's change stays in A.
    await call(`/api/applications/${appsA[0].id}`, { method: 'PUT', cookie: b, json: { title: 'B was here' } })
    await call(`/api/applications/${appsA[1].id}`, { method: 'DELETE', cookie: b })
    const after = await json<{ id: string; title: string }[]>(await call('/api/applications', { cookie: a }))
    expect(after).toHaveLength(10)
    expect(after.map((x) => x.title)).not.toContain('B was here')
    await call(`/api/applications/${appsA[0].id}`, { method: 'PUT', cookie: a, json: { title: 'Only in A' } })
    const inB = await json<{ title: string }[]>(await call('/api/applications', { cookie: b }))
    expect(inB.map((x) => x.title)).not.toContain('Only in A')
    const inReal = await json<{ title: string }[]>(await call('/api/applications', { cookie: real }))
    expect(inReal.map((x) => x.title)).toEqual(['Real job'])
  })

  it('counts wrong passwords against the address only, so nobody can lock the demo for others', async () => {
    const ip = '192.0.2.10'
    for (let i = 0; i < 5; i++) expect((await demoLogin(ip, 'wrong-password')).status).toBe(401)
    expect((await demoLogin(ip)).status).toBe(429)
    expect((await demoLogin()).status).toBe(200)
  })

  it('lets one address start three sandboxes an hour', async () => {
    const ip = '192.0.2.20'
    for (let i = 0; i < 3; i++) expect((await demoLogin(ip)).status).toBe(200)
    const fourth = await demoLogin(ip)
    expect(fourth.status).toBe(429)
    expect((await json<{ error: string }>(fourth)).error).toMatch(/several times/)
  })

  it('caps how many sandboxes run at once', async () => {
    // Fill the remaining room, each from a new address; the next one is refused.
    let status = 200
    for (let i = 0; i < 30 && status === 200; i++) status = (await demoLogin()).status
    expect(status).toBe(429)
    await env.DB.prepare("UPDATE demo_sandboxes SET expires_at = 0, created_at = 0 WHERE owner LIKE 'demo~%'").run()
    await purgeExpired(env, 500)
    expect((await demoLogin()).status).toBe(200)
  })

  it('reserves the name "demo" for the demo', () => {
    expect(usernameProblem('demo')).toMatch(/reserved/)
  })

  it('is just a wrong password when the demo is off', async () => {
    const off = { ...env, DEMO_PASSWORD: undefined } as unknown as Env
    const res = await call('/api/auth/login', { method: 'POST', json: { username: 'demo', password: DEMO_PW }, env: off })
    expect(res.status).toBe(401)
  })
})

describe('what a sandbox may do', () => {
  let cookie = ''
  let appId = ''
  let cvId = ''

  beforeAll(async () => {
    cookie = cookieOf(await demoLogin())
    appId = (await json<{ id: string }[]>(await call('/api/applications', { cookie })))[0].id
    cvId = (await json<{ id: string }[]>(await call('/api/resumes', { cookie })))[0].id
  })

  it('edits CVs, cards, letters and settings', async () => {
    const cv = await json<Record<string, unknown>>(await call(`/api/resumes/${cvId}`, { cookie }))
    expect((await call(`/api/resumes/${cvId}`, { method: 'PUT', cookie, json: { ...cv, name: 'Renamed' } })).status).toBe(200)
    expect((await call(`/api/applications/${appId}`, { method: 'PUT', cookie, json: { stage: 'applied' } })).status).toBe(200)
    expect((await call('/api/board-columns', { method: 'PUT', cookie, json: { columns: [] } })).status).toBe(200)
    expect((await call('/api/resumes', { method: 'POST', cookie, json: { duplicateOf: cvId } })).status).toBe(201)
  })

  it('has no AI, PDFs, link reading, uploads, connector or account settings', async () => {
    const off: [string, string, unknown?][] = [
      ['POST', '/api/ai/tailor', { baseId: cvId, job: { title: 'x' } }],
      ['POST', '/api/ai/letter', { applicationId: appId, lang: 'en' }],
      ['POST', '/api/ai/job-from-url', { url: 'https://example.com/job' }],
      ['POST', `/api/applications/${appId}/ai-check`, { doc: 'cv', lang: 'en' }],
      ['POST', '/api/applications/read-link', { url: 'http://169.254.169.254/' }],
      ['POST', `/api/applications/${appId}/logo`, {}],
      ['GET', `/api/pdf/${cvId}`],
      ['GET', `/api/applications/${appId}/letter.pdf?lang=en`],
      ['GET', '/api/connector'],
      ['GET', '/api/accounts'],
      ['POST', '/api/accounts/invites', {}],
      ['POST', '/api/auth/password', { current: DEMO_PW, password: 'a brand new password 99' }],
    ]
    for (const [method, path, body] of off) {
      const res = await call(path, { method, cookie, json: body })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    const upload = await app.request(
      `${LOCAL}/api/assets`,
      { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'image/png', Cookie: cookie }, body: new Uint8Array(10) },
      env,
      ctx,
    )
    expect(upload.status).toBe(403)
    expect(await json(await call('/api/ai/status', { cookie }))).toMatchObject({ provider: 'none', spend: null, detector: null })
  })

  it('refuses large bodies', async () => {
    const res = await call(`/api/applications/${appId}`, { method: 'PUT', cookie, body: JSON.stringify({ notes: 'x'.repeat(400_000) }) })
    expect(res.status).toBe(413)
  })

  it('keeps to a few CVs', async () => {
    let status = 201
    for (let i = 0; i < 15 && status === 201; i++) status = (await call('/api/resumes', { method: 'POST', cookie, json: { duplicateOf: cvId } })).status
    expect(status).toBe(403)
  })

  it('stops writing once its budget of changes is spent', async () => {
    await env.DB.prepare('UPDATE demo_sandboxes SET writes = 400 WHERE owner = ?').bind(ownerOf(cookie)).run()
    const res = await call(`/api/applications/${appId}`, { method: 'PUT', cookie, json: { stage: 'draft' } })
    expect(res.status).toBe(429)
    // Reading still works.
    expect((await call('/api/applications', { cookie })).status).toBe(200)
  })
})

describe('the end of a sandbox', () => {
  it('deletes its data when it runs out, and keeps real accounts', async () => {
    const cookie = cookieOf(await demoLogin())
    const owner = ownerOf(cookie)
    await call('/api/library', { method: 'PUT', cookie, json: { projects: [], skills: [], experience: [], certifications: [], notes: 'mine' } })
    await env.DB.prepare('UPDATE demo_sandboxes SET expires_at = 1 WHERE owner = ?').bind(owner).run()
    // An ended sandbox takes no more writes, even with a cookie that has not expired yet.
    expect((await call('/api/board-columns', { method: 'PUT', cookie, json: { columns: [] } })).status).toBe(429)
    await purgeExpired(env, 500)
    const count = async (sql: string) => (await env.DB.prepare(sql).bind(owner).first<{ n: number }>())!.n
    expect(await count('SELECT COUNT(*) AS n FROM resumes WHERE owner = ?')).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM applications WHERE owner = ?')).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM settings WHERE key LIKE ? || ':%'")).toBe(0)
    // Reading the ended sandbox does not bring it back.
    await call('/api/resumes', { cookie })
    expect(await count('SELECT COUNT(*) AS n FROM resumes WHERE owner = ?')).toBe(0)
    expect(await json<unknown[]>(await call('/api/applications', { cookie: real }))).toHaveLength(1)
  })

  it('ends at sign-out', async () => {
    const cookie = cookieOf(await demoLogin())
    await call('/api/auth/logout', { method: 'POST', cookie, json: {} })
    await purgeExpired(env, 500)
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM resumes WHERE owner = ?').bind(ownerOf(cookie)).first<{ n: number }>()
    expect(row!.n).toBe(0)
  })

  it('ends for everyone when DEMO_PASSWORD changes or is removed', async () => {
    const cookie = cookieOf(await demoLogin())
    expect(await json(await call('/api/auth/me', { cookie }))).toMatchObject({ authenticated: true })
    const rotated = { ...env, DEMO_PASSWORD: 'a-new-demo-password' } as unknown as Env
    expect(await json(await call('/api/auth/me', { cookie, env: rotated }))).toMatchObject({ authenticated: false })
    const off = { ...env, DEMO_PASSWORD: undefined } as unknown as Env
    expect((await call('/api/resumes', { cookie, env: off })).status).toBe(401)
  })

  it('cannot be forged', async () => {
    const cookie = cookieOf(await demoLogin())
    const [owner, exp] = cookie.split('=')[1].split('.')
    const forged = `rs_session=${owner}.${Number(exp) + 86_400}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    expect((await call('/api/resumes', { cookie: forged })).status).toBe(401)
    expect((await call('/api/resumes', { cookie: 'rs_session=demo~someoneelse.9999999999.x' })).status).toBe(401)
  })
})
