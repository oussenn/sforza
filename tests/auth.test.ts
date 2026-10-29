import { beforeAll, describe, expect, it } from 'vitest'
import { checkPrintToken, checkShare, connectorToken, connectorUser, primaryUser, signPrintToken, signShare, verifyLogin } from '../worker/auth'

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

async function hash(password: string, salt: Uint8Array, iterations = 1000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

let env: Env

beforeAll(async () => {
  env = {
    AUTH_USERS: JSON.stringify({
      alice: await hash('correct horse', new Uint8Array(16).fill(1)),
      bob: await hash('battery staple', new Uint8Array(16).fill(2)),
    }),
    SESSION_SECRET: 'test-session-secret',
    MCP_TOKEN: 'test-connector-token-0123456789abcdef',
  } as unknown as Env
})

describe('sign-in', () => {
  it('accepts the right password, case-insensitive username', async () => {
    expect(await verifyLogin(env, 'alice', 'correct horse')).toBe('alice')
    expect(await verifyLogin(env, ' Bob ', 'battery staple')).toBe('bob')
  })

  it('refuses a wrong password, another account\'s password and unknown users', async () => {
    expect(await verifyLogin(env, 'alice', 'wrong')).toBeNull()
    expect(await verifyLogin(env, 'alice', 'battery staple')).toBeNull()
    expect(await verifyLogin(env, 'nobody', 'correct horse')).toBeNull()
    expect(await verifyLogin(env, 'alice', '')).toBeNull()
  })
})

describe('signed links carry their account', () => {
  it('share links resolve to the signing account only for the same document', async () => {
    const t = await signShare(env, 'bob', 'cv', 'cv_1', 'en')
    expect(await checkShare(env, 'cv', 'cv_1', 'en', t)).toBe('bob')
    expect(await checkShare(env, 'cv', 'cv_2', 'en', t)).toBeNull()
    expect(await checkShare(env, 'cv', 'cv_1', 'de', t)).toBeNull()
    expect(await checkShare(env, 'letter', 'cv_1', 'en', t)).toBeNull()
  })

  it('refuses tampered and expired tokens', async () => {
    const t = await signPrintToken(env, 'alice', 'master')
    expect(await checkPrintToken(env, 'master', t)).toBe('alice')
    expect(await checkPrintToken(env, 'master', t.replace(/^alice/, 'bob'))).toBeNull()
    expect(await checkPrintToken(env, 'master', `${t.slice(0, -2)}xx`)).toBeNull()
    expect(await checkPrintToken(env, 'master', await signPrintToken(env, 'alice', 'master', -10))).toBeNull()
  })
})

describe('connector tokens', () => {
  it('give each account its own connector', async () => {
    const primary = await connectorToken(env, 'alice')
    const bob = await connectorToken(env, 'bob')
    expect(primary).toBe(env.MCP_TOKEN)
    expect(bob).not.toBe(primary)
    expect(await connectorUser(env, primary!)).toBe('alice')
    expect(await connectorUser(env, bob!)).toBe('bob')
  })

  it('refuse unknown or altered tokens', async () => {
    const bob = (await connectorToken(env, 'bob'))!
    expect(await connectorUser(env, `${bob.slice(0, -1)}A`)).toBeNull()
    expect(await connectorUser(env, 'guess')).toBeNull()
    expect(await connectorUser(env, undefined)).toBeNull()
  })
})

describe('primary account', () => {
  it('is the first account unless PRIMARY_USER names another', () => {
    expect(primaryUser(env)).toBe('alice')
    expect(primaryUser({ ...env, PRIMARY_USER: ' Bob ' })).toBe('bob')
  })

  it('owns MCP_TOKEN as its connector token', async () => {
    expect(await connectorToken({ ...env, PRIMARY_USER: 'bob' }, 'bob')).toBe(env.MCP_TOKEN)
  })
})
