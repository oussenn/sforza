import { beforeAll, describe, expect, it } from 'vitest'
import app from '../worker/index'
import { memoryD1 } from './d1'

// Requests for access from the sign-in page, answered by the admin with an invitation by mail; the welcome tour flag.

const LOCAL = 'http://localhost:5173'
const OWNER_PW = 'purple otter lantern 42'

let env: Env
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext
let ip = 0

function call(path: string, { method = 'GET', json, cookie, from, e = env }: { method?: string; json?: unknown; cookie?: string; from?: string; e?: Env } = {}) {
  const headers = new Headers({ 'X-Requested-With': 'fetch', 'cf-connecting-ip': from ?? `198.51.100.${++ip}` })
  if (cookie) headers.set('Cookie', cookie)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  return app.request(`${LOCAL}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, e, ctx)
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.match(/rs_session=[^;]+/)?.[0] ?? ''
const ask = (json: unknown, from?: string) => call('/api/auth/request-access', { method: 'POST', json, from })

interface Requests {
  requests: { id: string; email: string; name: string; note: string; status: string; username?: string }[]
  invites: { id: string; email?: string }[]
  mail: boolean
}
let owner = ''

beforeAll(async () => {
  env = { DB: memoryD1(), SESSION_SECRET: 'test-session-secret-0123456789' } as unknown as Env
  owner = cookieOf(await call('/api/auth/setup', { method: 'POST', json: { username: 'owner', password: OWNER_PW } }))
})

describe('requesting access', () => {
  it('takes an email address, a name and a note, and answers the same for a repeat', async () => {
    expect((await ask({ email: 'Ada@Example.org', name: ' Ada ', note: 'Friend of the owner' })).status).toBe(200)
    expect((await ask({ email: 'ada@example.org', name: 'Ada L.' })).status).toBe(200)
    const { requests } = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ email: 'ada@example.org', name: 'Ada L.', status: 'pending' })
  })

  it('refuses an address that is not one', async () => {
    for (const email of ['', 'ada', 'ada@', 'a b@example.org', 'ada@example', '<x>@example.org']) expect((await ask({ email })).status).toBe(400)
  })

  it('drops what the hidden field gives away as a bot', async () => {
    expect((await ask({ email: 'bot@example.org', website: 'http://spam.example' })).status).toBe(200)
    const { requests } = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(requests.map((r) => r.email)).not.toContain('bot@example.org')
  })

  it('allows three requests per address an hour', async () => {
    const from = '192.0.2.77'
    for (let i = 0; i < 3; i++) expect((await ask({ email: `p${i}@example.org` }, from)).status).toBe(200)
    expect((await ask({ email: 'p3@example.org' }, from)).status).toBe(429)
    // Signing in from that address is not affected.
    expect((await call('/api/auth/login', { method: 'POST', json: { username: 'owner', password: OWNER_PW }, from })).status).toBe(200)
  })

  it('shows the admin how many wait, and nobody else sees the list', async () => {
    const me = (await (await call('/api/auth/me', { cookie: owner })).json()) as { admin?: boolean; pendingRequests?: number }
    expect(me.admin).toBe(true)
    expect(me.pendingRequests).toBe(4)
    expect((await call('/api/accounts')).status).toBe(401)
  })
})

describe('answering a request', () => {
  it('makes an invitation for that address, written as an email when the server cannot send mail', async () => {
    const { requests, mail } = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(mail).toBe(false)
    const ada = requests.find((r) => r.email === 'ada@example.org')!
    const res = await call(`/api/accounts/requests/${ada.id}/invite`, { method: 'POST', json: {}, cookie: owner })
    const body = (await res.json()) as { url: string; email: string; sent: boolean; mail: { subject: string; text: string } }
    expect(body.sent).toBe(false)
    expect(body.email).toBe('ada@example.org')
    expect(body.mail.text).toContain(body.url)
    expect(body.mail.text).toMatch(/^Hi Ada L\.,/)

    const after = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(after.requests.find((r) => r.id === ada.id)?.status).toBe('invited')
    expect(after.invites.find((i) => i.email === 'ada@example.org')).toBeTruthy()

    // Joining with it shows who they became.
    const code = body.url.split('#')[1]
    expect((await call('/api/auth/join', { method: 'POST', json: { code, username: 'ada', password: 'copper willow garden 8' } })).status).toBe(200)
    const joined = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(joined.requests.find((r) => r.id === ada.id)).toMatchObject({ status: 'joined', username: 'ada' })
  })

  it('sends the invitation itself when mail is set up', async () => {
    const sent: { to: string; subject: string; text: string }[] = []
    const withMail = { ...env, MAIL_FROM: 'sforza@example.com', EMAIL: { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) } } as unknown as Env
    const { requests, mail } = (await (await call('/api/accounts', { cookie: owner, e: withMail })).json()) as Requests
    expect(mail).toBe(true)
    const p0 = requests.find((r) => r.email === 'p0@example.org')!
    const body = (await (await call(`/api/accounts/requests/${p0.id}/invite`, { method: 'POST', json: {}, cookie: owner, e: withMail })).json()) as { sent: boolean; url: string }
    expect(body.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('p0@example.org')
    expect(sent[0].text).toContain(body.url)
  })

  it('puts a request back to waiting when its invitation is revoked, and declines one', async () => {
    const { invites, requests } = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    const invite = invites.find((i) => i.email === 'p0@example.org')!
    expect((await call(`/api/accounts/invites/${invite.id}`, { method: 'DELETE', cookie: owner })).status).toBe(200)
    const p0 = requests.find((r) => r.email === 'p0@example.org')!
    const back = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(back.requests.find((r) => r.id === p0.id)?.status).toBe('pending')

    const p1 = requests.find((r) => r.email === 'p1@example.org')!
    expect((await call(`/api/accounts/requests/${p1.id}`, { method: 'DELETE', cookie: owner })).status).toBe(200)
    const left = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect(left.requests.map((r) => r.email)).not.toContain('p1@example.org')
  })

  it('is for the admin only', async () => {
    const ada = cookieOf(await call('/api/auth/login', { method: 'POST', json: { username: 'ada', password: 'copper willow garden 8' } }))
    const { requests } = (await (await call('/api/accounts', { cookie: owner })).json()) as Requests
    expect((await call(`/api/accounts/requests/${requests[0].id}/invite`, { method: 'POST', json: {}, cookie: ada })).status).toBe(403)
    expect((await call(`/api/accounts/requests/${requests[0].id}`, { method: 'DELETE', cookie: ada })).status).toBe(403)
    const me = (await (await call('/api/auth/me', { cookie: ada })).json()) as Record<string, unknown>
    expect(me.admin).toBeUndefined()
    expect(me.pendingRequests).toBeUndefined()
  })
})

describe('the welcome tour', () => {
  it('shows once per account, and can be asked for again', async () => {
    const seen = async () => ((await (await call('/api/auth/me', { cookie: owner })).json()) as { tourSeen: boolean }).tourSeen
    expect(await seen()).toBe(false)
    expect((await call('/api/onboarding', { method: 'PUT', json: { seen: true }, cookie: owner })).status).toBe(200)
    expect(await seen()).toBe(true)
    expect((await call('/api/onboarding', { method: 'PUT', json: { seen: false }, cookie: owner })).status).toBe(200)
    expect(await seen()).toBe(false)
    expect((await call('/api/onboarding', { method: 'PUT', json: { seen: 'yes' }, cookie: owner })).status).toBe(400)
    expect((await call('/api/onboarding', { method: 'PUT', json: { seen: true } })).status).toBe(401)
  })
})
