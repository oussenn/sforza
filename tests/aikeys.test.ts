import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from '../worker/index'
import { aiRoutes, aiStatus, generateJson, type AiEnv } from '../worker/ai'
import { openKey, sealKey } from '../worker/aikeys'
import * as db from '../worker/db'
import { demoRouteAllowed } from '../worker/demo'
import { memoryD1 } from './d1'

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

async function hash(password: string, salt: Uint8Array, iterations = 1000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

let env: Env
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext
const cookies: Record<string, string> = {}
const call = (path: string, as: 'alice' | 'bob', json?: unknown, method = json === undefined ? 'GET' : 'PUT') =>
  app.request(
    path,
    {
      method,
      headers: { Cookie: cookies[as], 'X-Requested-With': 'fetch', 'cf-connecting-ip': '198.51.100.7', ...(json !== undefined && { 'Content-Type': 'application/json' }) },
      ...(json !== undefined && { body: JSON.stringify(json) }),
    },
    env,
    ctx,
  )

const GOOD_OPENAI = `sk-proj-${'a'.repeat(40)}good`
const BAD_OPENAI = `sk-proj-${'b'.repeat(40)}nope`
const GOOD_ANTHROPIC = `sk-ant-api03-${'c'.repeat(40)}good`

// The providers as seen by the server: a key is good when it ends in "good"; chat answers {"ok":"openai"}.
const seen: string[] = []
beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const key = headers.get('x-api-key') ?? headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    seen.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`)
    const good = key.endsWith('good')
    if (url.startsWith('https://api.openai.com/v1/models') || url.startsWith('https://api.anthropic.com/v1/models')) {
      return new Response(JSON.stringify(good ? { data: [], has_more: false } : { error: { type: 'authentication_error', message: 'invalid key' } }), {
        status: good ? 200 : 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://api.anthropic.com/v1/messages')) {
      // Anthropic is down for this test: the call must move on to OpenAI.
      return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://api.openai.com/v1/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":"openai"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
        status: good ? 200 : 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not stubbed', { status: 599 })
  })
  env = {
    DB: memoryD1(),
    AUTH_USERS: JSON.stringify({ alice: await hash('correct horse', new Uint8Array(16).fill(1)), bob: await hash('battery staple', new Uint8Array(16).fill(2)) }),
    SESSION_SECRET: 'test-session-secret-0123456789',
  } as unknown as Env
  for (const [user, password] of [['alice', 'correct horse'], ['bob', 'battery staple']] as const) {
    const res = await app.request(
      '/api/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'cf-connecting-ip': '198.51.100.7' }, body: JSON.stringify({ username: user, password }) },
      env,
      ctx,
    )
    cookies[user] = res.headers.get('set-cookie')?.match(/rs_session=[^;]+/)?.[0] ?? ''
  }
})
afterAll(() => vi.unstubAllGlobals())

describe("an account's own AI keys", () => {
  it('seals a key for one account: another account cannot open it', async () => {
    const sealed = await sealKey(env, 'alice', GOOD_OPENAI)
    expect(sealed.enc).not.toContain('good')
    expect(await openKey(env, 'alice', sealed)).toBe(GOOD_OPENAI)
    expect(await openKey(env, 'bob', sealed)).toBeNull()
    expect(await openKey({ SESSION_SECRET: 'another-secret-0123456789' }, 'alice', sealed)).toBeNull()
  })

  it('checks a key before saving it, refuses wrong ones and never sends a key back', async () => {
    const empty = await (await call('/api/ai/settings', 'alice')).json()
    expect(empty.keys.openai.set).toBe(false)
    expect(empty.active.provider).toBe('none')

    const shape = await call('/api/ai/settings', 'alice', { keys: { openai: 'not-a-key' } })
    expect(shape.status).toBe(422)
    const wrong = await call('/api/ai/settings', 'alice', { keys: { openai: BAD_OPENAI } })
    expect(wrong.status).toBe(422)
    expect((await wrong.json()).error).toContain('rejected')

    const saved = await call('/api/ai/settings', 'alice', { keys: { openai: GOOD_OPENAI } })
    expect(saved.status).toBe(200)
    const text = await saved.text()
    expect(text).not.toContain(GOOD_OPENAI)
    const view = JSON.parse(text)
    expect(view.keys.openai).toMatchObject({ set: true, hint: 'sk-…good', ok: true })
    expect(view.active).toMatchObject({ provider: 'openai', model: 'gpt-5.6-luna', source: 'own', fallback: null })

    // At rest only the sealed key: the plain key appears nowhere in the stored setting.
    const raw = await db.getAiSettingsRaw(db.forOwner(env, 'alice'))
    expect(raw).toBeTruthy()
    expect(raw).not.toContain(GOOD_OPENAI)
    // Bob has no key of his own.
    expect((await (await call('/api/ai/settings', 'bob')).json()).keys.openai.set).toBe(false)
  })

  it('puts Anthropic first, the other key as backup, and follows a manual choice', async () => {
    const both = await (await call('/api/ai/settings', 'alice', { keys: { anthropic: GOOD_ANTHROPIC } })).json()
    expect(both.active).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', source: 'own', fallback: { provider: 'openai', model: 'gpt-5.6-luna' } })
    const manual = await (await call('/api/ai/settings', 'alice', { mode: 'manual', provider: 'openai', model: 'gpt-5.6-sol' })).json()
    expect(manual.active).toMatchObject({ provider: 'openai', model: 'gpt-5.6-sol', fallback: { provider: 'anthropic', model: 'claude-opus-5-5' } })
    expect((await call('/api/ai/settings', 'alice', { model: 'bad model id!' })).status).toBe(422)
    // The status the editor reads says the same, and no budget: the account pays for its own calls.
    const status = await (await call('/api/ai/status', 'alice')).json()
    expect(status).toMatchObject({ provider: 'openai', model: 'gpt-5.6-sol', source: 'own', spend: null })
  })

  it('moves to the next provider when one fails, and never to the site AI when the account has keys', async () => {
    const own: AiEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-site-key', ACCOUNT_AI: { anthropic: GOOD_ANTHROPIC.replace('good', 'down'), openai: GOOD_OPENAI, mode: 'auto', provider: 'anthropic', model: '' } }
    expect(aiRoutes(own).map((r) => `${r.provider}:${r.own}`)).toEqual(['anthropic:true', 'openai:true'])
    seen.length = 0
    const out = await generateJson<{ ok: string }>(own, { system: 's', prompt: 'p', schema: { type: 'object' }, effort: 'low' })
    expect(out).toEqual({ ok: 'openai' })
    expect(seen.some((s) => s.startsWith('POST https://api.anthropic.com/v1/messages'))).toBe(true)
    expect(seen.some((s) => s.startsWith('POST https://api.openai.com/v1/chat/completions'))).toBe(true)
    // Without own keys the site's AI answers, as before.
    expect(aiStatus({ ...env, ANTHROPIC_API_KEY: 'sk-ant-site-key' })).toMatchObject({ provider: 'anthropic', source: 'site' })
  })

  it('removes a key on request, and keeps the settings out of the demo', async () => {
    const view = await (await call('/api/ai/settings', 'alice', { keys: { openai: null, anthropic: null } })).json()
    expect(view.keys.openai.set).toBe(false)
    expect(view.keys.anthropic.set).toBe(false)
    expect(demoRouteAllowed('GET', '/api/ai/settings')).toBe(false)
    expect(demoRouteAllowed('PUT', '/api/ai/settings')).toBe(false)
  })
})
