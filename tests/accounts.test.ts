import { beforeAll, describe, expect, it } from 'vitest'
import app from '../worker/index'
import { connectorToken } from '../worker/auth'
import { memoryD1 } from './d1'

// Accounts made in the app: first-run setup, invitations, password changes and locking, on one database that
// starts without any account.

const SITE = 'https://cv.example.com'
const LOCAL = 'http://localhost:5173'
const SETUP_TOKEN = 'setup-token-0123456789abcdef'
const OWNER_PW = 'purple otter lantern 42'
const CAROL_PW = 'quiet harbour violin 7'

let env: Env
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext
let ipCounter = 0

interface Call {
  method?: string
  json?: unknown
  cookie?: string
  bearer?: string
  env?: Env
}

/** Each call comes from its own address, so the per-address lock never gets in the way of the next test. */
function call(url: string, { method = 'GET', json, cookie, bearer, env: e = env }: Call = {}) {
  const headers = new Headers({ 'X-Requested-With': 'fetch', 'cf-connecting-ip': `203.0.113.${++ipCounter}` })
  if (cookie) headers.set('Cookie', cookie)
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  return app.request(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, e, ctx)
}

const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(/rs_session=[^;]+/)?.[0] ?? ''
const login = (username: string, password: string) => call(`${SITE}/api/auth/login`, { method: 'POST', json: { username, password } })
const codeOf = (url: string) => url.split('#')[1]

let owner = ''
let carol = ''

beforeAll(() => {
  env = {
    DB: memoryD1(),
    SESSION_SECRET: 'test-session-secret-0123456789',
    MCP_TOKEN: 'test-connector-token-0123456789abcdef',
  } as unknown as Env
})

describe('first-run setup', () => {
  it('is offered while the site has no account, with a token on a public address only', async () => {
    expect(await (await call(`${SITE}/api/auth/me`)).json()).toEqual({ authenticated: false, user: null, setup: { needsToken: true } })
    expect(await (await call(`${LOCAL}/api/auth/me`)).json()).toEqual({ authenticated: false, user: null, setup: { needsToken: false } })
  })

  it('needs SETUP_TOKEN on a public address', async () => {
    const res = await call(`${SITE}/api/auth/setup`, { method: 'POST', json: { username: 'owner', password: OWNER_PW } })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/SETUP_TOKEN/)
    const withSecret = { ...env, SETUP_TOKEN } as Env
    const wrong = await call(`${SITE}/api/auth/setup`, { method: 'POST', json: { username: 'owner', password: OWNER_PW, setupToken: 'guess' }, env: withSecret })
    expect(wrong.status).toBe(403)
  })

  it('checks the username and password, and needs no token locally', async () => {
    const setup = (json: unknown) => call(`${LOCAL}/api/auth/setup`, { method: 'POST', json })
    expect((await setup({ username: 'owner', password: 'short' })).status).toBe(400)
    expect((await setup({ username: 'owner', password: 'owner owner owner 1' })).status).toBe(400)
    expect((await setup({ username: 'Owner!', password: OWNER_PW })).status).toBe(400)
  })

  it('creates the first account with the token and signs it in', async () => {
    const withSecret = { ...env, SETUP_TOKEN } as Env
    const res = await call(`${SITE}/api/auth/setup`, { method: 'POST', json: { username: 'Owner', password: OWNER_PW, setupToken: SETUP_TOKEN }, env: withSecret })
    expect(res.status).toBe(200)
    owner = cookieOf(res)
    expect(await (await call(`${SITE}/api/auth/me`, { cookie: owner })).json()).toEqual({ authenticated: true, user: 'owner' })
  })

  it('closes once an account exists', async () => {
    const res = await call(`${LOCAL}/api/auth/setup`, { method: 'POST', json: { username: 'intruder', password: 'another long password 9' } })
    expect(res.status).toBe(403)
    expect(await (await call(`${SITE}/api/auth/me`)).json()).toEqual({ authenticated: false, user: null })
  })

  it('stores a salted hash, never the password', async () => {
    const row = await env.DB.prepare('SELECT hash FROM accounts WHERE username = ?').bind('owner').first<{ hash: string }>()
    expect(row?.hash).toMatch(/^pbkdf2-sha256\$100000\$[\w-]{22}\$[\w-]{43}$/)
    expect(row?.hash).not.toContain(OWNER_PW)
  })
})

describe('invitations', () => {
  it('only the admin lists accounts and invites', async () => {
    const res = await call(`${SITE}/api/accounts`, { cookie: owner })
    expect(await res.json()).toEqual({ accounts: [{ username: 'owner', source: 'app', disabled: false, admin: true }], invites: [] })
  })

  it('make an account once, with the code in the fragment only', async () => {
    const { url } = (await (await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {}, cookie: owner })).json()) as { url: string }
    expect(url).toMatch(/^https:\/\/cv\.example\.com\/join#[\w-]{43}$/)
    const stored = await env.DB.prepare('SELECT id FROM invites').all<{ id: string }>()
    expect(stored.results.map((r) => r.id)).not.toContain(codeOf(url))

    const join = (json: unknown) => call(`${SITE}/api/auth/join`, { method: 'POST', json })
    expect((await join({ code: 'not-a-code', username: 'carol', password: CAROL_PW })).status).toBe(403)
    expect((await join({ code: codeOf(url), username: 'carol', password: 'too short' })).status).toBe(400)
    const ok = await join({ code: codeOf(url), username: 'carol', password: CAROL_PW })
    expect(ok.status).toBe(200)
    carol = cookieOf(ok)
    expect((await call(`${SITE}/api/resumes`, { cookie: carol })).status).toBe(200)
    expect((await join({ code: codeOf(url), username: 'carol2', password: CAROL_PW })).status).toBe(403)
  })

  it('refuse a taken username without using the invitation up', async () => {
    const { url } = (await (await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {}, cookie: owner })).json()) as { url: string }
    const join = (username: string) => call(`${SITE}/api/auth/join`, { method: 'POST', json: { code: codeOf(url), username, password: 'silver meadow kettle 5' } })
    expect((await join('owner')).status).toBe(409)
    expect((await join('carol')).status).toBe(409)
    expect((await join('dave')).status).toBe(200)
  })

  it('expire, and can be revoked', async () => {
    const make = async () => (await (await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {}, cookie: owner })).json()) as { url: string }
    const old = await make()
    await env.DB.prepare('UPDATE invites SET expires_at = 1').run()
    expect((await call(`${SITE}/api/auth/join`, { method: 'POST', json: { code: codeOf(old.url), username: 'erin', password: 'silver meadow kettle 5' } })).status).toBe(403)

    await make()
    const { invites } = (await (await call(`${SITE}/api/accounts`, { cookie: owner })).json()) as { invites: { id: string }[] }
    expect(invites).toHaveLength(1)
    expect((await call(`${SITE}/api/accounts/invites/${invites[0].id}`, { method: 'DELETE', cookie: owner })).status).toBe(200)
    expect(((await (await call(`${SITE}/api/accounts`, { cookie: owner })).json()) as { invites: unknown[] }).invites).toHaveLength(0)
  })

  it('cannot be made or listed by other accounts', async () => {
    expect((await call(`${SITE}/api/accounts`, { cookie: carol })).status).toBe(403)
    expect((await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {}, cookie: carol })).status).toBe(403)
    expect((await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {} })).status).toBe(401)
  })
})

describe('changing a password', () => {
  it('needs the current one and a strong new one', async () => {
    const change = (json: unknown) => call(`${SITE}/api/auth/password`, { method: 'POST', json, cookie: carol })
    expect((await change({ current: 'wrong password here', password: 'brand new passphrase 1' })).status).toBe(403)
    expect((await change({ current: CAROL_PW, password: 'short' })).status).toBe(400)
    expect((await change({ current: CAROL_PW, password: CAROL_PW })).status).toBe(400)
  })

  it('ends every older session and keeps this one signed in', async () => {
    const other = cookieOf(await login('carol', CAROL_PW))
    const res = await call(`${SITE}/api/auth/password`, { method: 'POST', json: { current: CAROL_PW, password: 'brand new passphrase 1' }, cookie: carol })
    expect(res.status).toBe(200)
    const fresh = cookieOf(res)
    expect((await call(`${SITE}/api/resumes`, { cookie: carol })).status).toBe(401)
    expect((await call(`${SITE}/api/resumes`, { cookie: other })).status).toBe(401)
    expect((await call(`${SITE}/api/resumes`, { cookie: fresh })).status).toBe(200)
    expect((await login('carol', CAROL_PW)).status).toBe(401)
    expect((await login('carol', 'brand new passphrase 1')).status).toBe(200)
    carol = fresh
  })
})

describe('locking an account', () => {
  it('signs it out everywhere, connector included, until it is unlocked', async () => {
    const token = (await connectorToken(env, 'carol'))!
    const mcp = () => call(`${SITE}/mcp`, { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'ping' }, bearer: token })
    expect((await mcp()).status).toBe(200)

    const lock = (disabled: boolean) => call(`${SITE}/api/accounts/carol/access`, { method: 'PUT', json: { disabled }, cookie: owner })
    expect((await lock(true)).status).toBe(200)
    expect((await call(`${SITE}/api/resumes`, { cookie: carol })).status).toBe(401)
    expect((await login('carol', 'brand new passphrase 1')).status).toBe(401)
    expect((await mcp()).status).toBe(401)

    expect((await lock(false)).status).toBe(200)
    expect((await login('carol', 'brand new passphrase 1')).status).toBe(200)
    expect((await mcp()).status).toBe(200)
  })

  it('is for the admin, and never their own account', async () => {
    expect((await call(`${SITE}/api/accounts/owner/access`, { method: 'PUT', json: { disabled: true }, cookie: owner })).status).toBe(400)
    expect((await call(`${SITE}/api/accounts/dave/access`, { method: 'PUT', json: { disabled: true }, cookie: carol })).status).toBe(403)
  })
})

describe('accounts from the AUTH_USERS secret', () => {
  let legacyEnv: Env

  beforeAll(async () => {
    const salt = new Uint8Array(16).fill(3)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('old secret password'), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, key, 256)
    const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url')
    legacyEnv = { ...env, AUTH_USERS: JSON.stringify({ legacy: `pbkdf2-sha256$1000$${b64(salt)}$${b64(new Uint8Array(bits))}` }) } as Env
  })

  it('keep working, and a password changed in the app wins over the secret', async () => {
    const signIn = (password: string) => call(`${SITE}/api/auth/login`, { method: 'POST', json: { username: 'legacy', password }, env: legacyEnv })
    const first = await signIn('old secret password')
    expect(first.status).toBe(200)
    const res = await call(`${SITE}/api/auth/password`, {
      method: 'POST',
      json: { current: 'old secret password', password: 'fresh app password 77' },
      cookie: cookieOf(first),
      env: legacyEnv,
    })
    expect(res.status).toBe(200)
    expect((await call(`${SITE}/api/resumes`, { cookie: cookieOf(first), env: legacyEnv })).status).toBe(401)
    expect((await signIn('old secret password')).status).toBe(401)
    expect((await signIn('fresh app password 77')).status).toBe(200)
  })

  it('cannot be claimed through an invitation', async () => {
    const { url } = (await (await call(`${SITE}/api/accounts/invites`, { method: 'POST', json: {}, cookie: owner })).json()) as { url: string }
    const fresh = { ...env, AUTH_USERS: JSON.stringify({ other: 'pbkdf2-sha256$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) } as Env
    const res = await call(`${SITE}/api/auth/join`, { method: 'POST', json: { code: codeOf(url), username: 'other', password: 'silver meadow kettle 5' }, env: fresh })
    expect(res.status).toBe(409)
  })
})
