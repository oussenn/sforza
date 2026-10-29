import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

const COOKIE = 'rs_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

const USERNAME = /^[a-z0-9_-]{2,32}$/
const PBKDF2_ITERATIONS = 100_000 // the Workers runtime maximum
const MIN_SECRET = 16

const encoder = new TextEncoder()

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
}

/* -------------------------------- accounts -------------------------------- */

interface StoredHash {
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
}

/**
 * Accounts come from the AUTH_USERS secret, a JSON object of username → "pbkdf2-sha256$<iterations>$<salt>$<hash>"
 * (base64url). Only hashes are stored, so the secret does not reveal a password; scripts/new-logins.mjs makes them.
 */
function accounts(env: { AUTH_USERS?: string }): Map<string, StoredHash> {
  const out = new Map<string, StoredHash>()
  const raw = env.AUTH_USERS
  if (!raw) return out
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    console.error('AUTH_USERS is not valid JSON')
    return out
  }
  for (const [user, value] of Object.entries(parsed)) {
    const [scheme, iterations, salt, hash] = typeof value === 'string' ? value.split('$') : []
    if (!USERNAME.test(user) || scheme !== 'pbkdf2-sha256' || !salt || !hash || !(Number(iterations) > 0)) continue
    out.set(user, { iterations: Number(iterations), salt: fromB64url(salt), hash: fromB64url(hash) })
  }
  return out
}

/** Sign-in works only with accounts and a session secret that is not empty or trivially short. */
export function authConfigured(env: Env): boolean {
  return accounts(env).size > 0 && (env.SESSION_SECRET?.length ?? 0) >= MIN_SECRET
}

/**
 * The primary account: PRIMARY_USER when set, else the first account in AUTH_USERS. It owns the rows stored before
 * accounts existed, keeps the unprefixed settings keys, and its connector token is MCP_TOKEN itself.
 */
export function primaryUser(env: { AUTH_USERS?: string; PRIMARY_USER?: string }): string {
  return env.PRIMARY_USER?.trim().toLowerCase() || accounts(env).keys().next().value || 'admin'
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

const DUMMY: StoredHash = { iterations: PBKDF2_ITERATIONS, salt: new Uint8Array(16), hash: new Uint8Array(32) }

/** Returns the username when the pair matches. An unknown user costs the same time as a wrong password. */
export async function verifyLogin(env: Env, username: string, password: string): Promise<string | null> {
  const user = username.trim().toLowerCase()
  const stored = accounts(env).get(user)
  const derived = await pbkdf2(password, (stored ?? DUMMY).salt, (stored ?? DUMMY).iterations)
  const equal = crypto.subtle.timingSafeEqual(derived, (stored ?? DUMMY).hash)
  return stored && equal && password.length > 0 ? user : null
}

/* --------------------------------- signing -------------------------------- */

async function hmacKey(env: Env): Promise<CryptoKey> {
  if ((env.SESSION_SECRET?.length ?? 0) < MIN_SECRET) throw new Error('SESSION_SECRET is missing or shorter than 16 characters')
  // Changing AUTH_USERS (a new password) invalidates every session and signed link.
  const secret = `${env.SESSION_SECRET}:${env.AUTH_USERS ?? ''}`
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function sign(env: Env, payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload)))
}

/** Tokens are "<user>.<exp>.<signature>"; returns the user when the signature over `payload(user, exp)` holds. */
async function verifyToken(env: Env, token: string | undefined, payload: (user: string, exp: number) => string): Promise<string | null> {
  if (!token || !authConfigured(env)) return null
  const [user, expRaw, sig] = token.split('.')
  const exp = Number(expRaw)
  if (!user || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000 || !accounts(env).has(user)) return null
  const expected = await sign(env, payload(user, exp))
  if (expected.length !== sig.length || !crypto.subtle.timingSafeEqual(encoder.encode(expected), encoder.encode(sig))) return null
  return user
}

async function makeToken(env: Env, user: string, ttlSeconds: number, payload: (user: string, exp: number) => string) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${user}.${exp}.${await sign(env, payload(user, exp))}`
}

/* -------------------------------- sessions -------------------------------- */

const sessionPayload = (user: string, exp: number) => `session:${user}:${exp}`

export async function issueSession(c: Context<{ Bindings: Env }>, user: string): Promise<void> {
  setCookie(c, COOKIE, await makeToken(c.env, user, MAX_AGE, sessionPayload), {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function clearSession(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, COOKIE, { path: '/', secure: true })
}

/** The signed-in username, or null. */
export async function sessionUser(c: Context<{ Bindings: Env }>): Promise<string | null> {
  return verifyToken(c.env, getCookie(c, COOKIE), sessionPayload)
}

/* ------------------------------ signed links ------------------------------ */

/** Short-lived token that lets the headless PDF browser load one specific CV or letter of one account. */
export function signPrintToken(env: Env, user: string, id: string, ttlSeconds = 120): Promise<string> {
  return makeToken(env, user, ttlSeconds, (u, exp) => `print:${u}:${id}:${exp}`)
}

/** The account the print token was issued for, or null. */
export function checkPrintToken(env: Env, id: string, token: string | undefined): Promise<string | null> {
  return verifyToken(env, token, (u, exp) => `print:${u}:${id}:${exp}`)
}

/** A download link that works without a session (for an agent's browser): one file, one language, expiring. */
export function signShare(env: Env, user: string, kind: 'cv' | 'letter', id: string, lang: string, ttlSeconds = 6 * 3600): Promise<string> {
  return makeToken(env, user, ttlSeconds, (u, exp) => `share:${u}:${kind}:${id}:${lang}:${exp}`)
}

export function checkShare(env: Env, kind: string, id: string, lang: string, token: string | undefined): Promise<string | null> {
  return verifyToken(env, token, (u, exp) => `share:${u}:${kind}:${id}:${lang}:${exp}`)
}

/* ------------------------------ login throttle ----------------------------- */

const IP_LIMIT = 5 // failed logins from one address before it is locked
const USER_LIMIT = 20 // failed logins on one account (from anywhere) before it is locked
const LOCK_SECONDS = 15 * 60

/** Seconds until the address or account may try again, 0 when allowed. */
export async function loginLocked(d1: D1Database, ip: string, user: string): Promise<number> {
  const { results } = await d1
    .prepare('SELECT locked_until FROM login_guard WHERE key IN (?, ?)')
    .bind(`ip:${ip}`, `user:${user}`)
    .all<{ locked_until: number }>()
  const until = Math.max(0, ...results.map((r) => r.locked_until))
  return Math.max(0, Math.ceil(until - Date.now() / 1000))
}

export async function recordLoginFailure(d1: D1Database, ip: string, user: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const bump = (key: string, limit: number) =>
    d1
      .prepare(
        `INSERT INTO login_guard (key, fails, locked_until) VALUES (?1, 1, 0)
         ON CONFLICT(key) DO UPDATE SET
           fails = CASE WHEN locked_until > 0 AND locked_until <= ?2 THEN 1 ELSE fails + 1 END,
           locked_until = CASE WHEN locked_until > 0 AND locked_until <= ?2 THEN 0
                               WHEN fails + 1 >= ?3 THEN ?2 + ?4 ELSE locked_until END`,
      )
      .bind(key, now, limit, LOCK_SECONDS)
  await d1.batch([bump(`ip:${ip}`, IP_LIMIT), bump(`user:${user.slice(0, 64)}`, USER_LIMIT)])
}

export async function clearLoginFailures(d1: D1Database, ip: string, user: string): Promise<void> {
  await d1.prepare('DELETE FROM login_guard WHERE key IN (?, ?)').bind(`ip:${ip}`, `user:${user}`).run()
}

/* ----------------------------------- MCP ---------------------------------- */

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value))
}

/**
 * The address for links and visitors: https://CANONICAL_HOST when it is set, else the one the request came in on
 * (local dev, workers.dev). A deployment that moved to a new domain keeps serving the old one for existing connectors.
 */
export function siteOrigin(env: { CANONICAL_HOST?: string }, requestUrl: string): string {
  const here = new URL(requestUrl)
  const host = env.CANONICAL_HOST?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host || ['localhost', '127.0.0.1', '[::1]'].includes(here.hostname)) return here.origin
  return `https://${host}`
}

/**
 * Each account's MCP connector token. The first account's is the MCP_TOKEN secret itself (its connector URL
 * predates accounts); every other account's is derived from it, so changing MCP_TOKEN replaces them all.
 */
export async function connectorToken(env: Env, user: string): Promise<string | null> {
  const secret = env.MCP_TOKEN
  if (!secret || secret.length < 24) return null
  if (user === primaryUser(env)) return secret
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(`connector:${user}`)))
}

/** The account a connector token belongs to, or null; compared in constant time. */
export async function connectorUser(env: Env, candidate: string | undefined): Promise<string | null> {
  if (!candidate) return null
  const wanted = await sha256(candidate)
  let found: string | null = null
  for (const user of accounts(env).keys()) {
    const token = await connectorToken(env, user)
    if (token && crypto.subtle.timingSafeEqual(wanted, await sha256(token))) found = user
  }
  return found
}
