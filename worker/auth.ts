import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AccountInfo, InviteInfo } from '@shared/types'
import { USERNAME_PATTERN } from '@shared/utils'

const COOKIE = 'rs_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

const PBKDF2_ITERATIONS = 100_000 // the Workers runtime maximum
const MIN_SECRET = 16
const INVITE_DAYS = 7

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

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value))
}

/** Compares two secrets in constant time (hashing first evens out their lengths). */
export async function sameSecret(given: unknown, expected: string): Promise<boolean> {
  if (typeof given !== 'string' || !given || !expected) return false
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected))
}

/** Local development: the only place the first account can be made without SETUP_TOKEN. */
export function isLocalRequest(requestUrl: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(requestUrl).hostname)
}

/* -------------------------------- accounts -------------------------------- */

interface StoredHash {
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
}

/** An account that may sign in. Its stamp changes with the password, and every token signs it (see `stamped`). */
interface Account extends StoredHash {
  stamp: string
}

type AccountEnv = { DB: D1Database; AUTH_USERS?: string; PRIMARY_USER?: string }

/** "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64url) → its parts, or null. */
function parseHash(value: unknown): StoredHash | null {
  const [scheme, iterations, salt, hash] = typeof value === 'string' ? value.split('$') : []
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash || !(Number(iterations) > 0)) return null
  try {
    return { iterations: Number(iterations), salt: fromB64url(salt), hash: fromB64url(hash) }
  } catch {
    return null
  }
}

/**
 * Accounts from the optional AUTH_USERS secret: a JSON object of username → password hash, made by
 * scripts/new-logins.mjs. Accounts made in the app live in the accounts table instead.
 */
function secretAccounts(env: { AUTH_USERS?: string }): Map<string, string> {
  const out = new Map<string, string>()
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
    if (USERNAME_PATTERN.test(user) && typeof value === 'string' && parseHash(value)) out.set(user, value)
  }
  return out
}

const stampOf = async (hash: string) => b64url(await sha256(`stamp:${hash}`)).slice(0, 16)

/**
 * The account `username` may sign in to, or null. A row in the accounts table wins over the AUTH_USERS secret:
 * a password changed in the app replaces the secret's, and a locked row shuts the account. Only PBKDF2 hashes are
 * stored, never a password.
 */
async function findAccount(env: AccountEnv, username: string): Promise<Account | null> {
  if (!USERNAME_PATTERN.test(username)) return null
  const row = await env.DB.prepare('SELECT hash, disabled FROM accounts WHERE username = ?')
    .bind(username)
    .first<{ hash: string; disabled: number }>()
  if (row) {
    const parsed = row.disabled ? null : parseHash(row.hash)
    return parsed && { ...parsed, stamp: await stampOf(row.hash) }
  }
  // Tokens of accounts that only live in the secret carry no stamp; they end when AUTH_USERS changes (hmacKey).
  const parsed = parseHash(secretAccounts(env).get(username))
  return parsed && { ...parsed, stamp: '' }
}

/** Every account that may sign in: the secret's in their order, then the ones made in the app, oldest first. */
async function accountNames(env: AccountEnv): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT username, disabled FROM accounts ORDER BY created_at, rowid').all<{
    username: string
    disabled: number
  }>()
  const locked = new Set(results.filter((r) => r.disabled).map((r) => r.username))
  return [...new Set([...secretAccounts(env).keys(), ...results.map((r) => r.username)])].filter((u) => !locked.has(u))
}

/** True once any account exists, locked ones included: first-run setup is closed from then on. */
export async function hasAccounts(env: AccountEnv): Promise<boolean> {
  if (secretAccounts(env).size) return true
  return !!(await env.DB.prepare('SELECT 1 AS one FROM accounts LIMIT 1').first())
}

/**
 * The primary account: PRIMARY_USER when set, else the first account in AUTH_USERS, else none (""). It owns the
 * rows stored before accounts existed, keeps the unprefixed settings keys, and its connector token is MCP_TOKEN
 * itself, so a deployment with app-made accounts only has no primary and nobody's connector shows MCP_TOKEN.
 */
export function primaryUser(env: { AUTH_USERS?: string; PRIMARY_USER?: string }): string {
  return env.PRIMARY_USER?.trim().toLowerCase() || secretAccounts(env).keys().next().value || ''
}

/** The account that invites people and can lock accounts: the primary one, else the first account made in the app. */
export async function adminUser(env: AccountEnv): Promise<string | null> {
  const primary = primaryUser(env)
  if (primary && (await findAccount(env, primary))) return primary
  const row = await env.DB.prepare('SELECT username FROM accounts WHERE disabled = 0 ORDER BY created_at, rowid LIMIT 1').first<{
    username: string
  }>()
  return row?.username ?? null
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

/** A new salted hash in the format AUTH_USERS uses, so both kinds of account are checked the same way. */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`
}

const DUMMY: StoredHash = { iterations: PBKDF2_ITERATIONS, salt: new Uint8Array(16), hash: new Uint8Array(32) }

/** Returns the username when the pair matches. An unknown or locked user costs the same time as a wrong password. */
export async function verifyLogin(env: AccountEnv, username: string, password: string): Promise<string | null> {
  const user = username.trim().toLowerCase()
  const account = await findAccount(env, user)
  const stored = account ?? DUMMY
  const derived = await pbkdf2(password, stored.salt, stored.iterations)
  const equal = crypto.subtle.timingSafeEqual(derived, stored.hash)
  return account && equal && password.length > 0 ? user : null
}

/** Is `username` in use, or kept for the primary account? Locked accounts keep their name, and with it their data. */
async function usernameTaken(env: AccountEnv, username: string): Promise<boolean> {
  if (username === primaryUser(env) || secretAccounts(env).has(username)) return true
  return !!(await env.DB.prepare('SELECT 1 AS one FROM accounts WHERE username = ?').bind(username).first())
}

/** First-run setup: makes the first account, only while there is none at all. False when one exists already. */
export async function createFirstAccount(env: AccountEnv, username: string, password: string): Promise<boolean> {
  if (secretAccounts(env).size) return false
  const now = new Date().toISOString()
  const { meta } = await env.DB.prepare(
    `INSERT INTO accounts (username, hash, disabled, created_at, updated_at)
     SELECT ?1, ?2, 0, ?3, ?3 WHERE NOT EXISTS (SELECT 1 FROM accounts)`,
  )
    .bind(username, await hashPassword(password), now)
    .run()
  return meta.changes === 1
}

/** A new password, stored in the app. It replaces the secret's for AUTH_USERS accounts and ends every older token. */
export async function setPassword(env: AccountEnv, username: string, password: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accounts (username, hash, disabled, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)
     ON CONFLICT(username) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`,
  )
    .bind(username, await hashPassword(password), new Date().toISOString())
    .run()
}

/** Locks or unlocks an account. A locked account cannot sign in, its sessions, links and connector stop at once. */
export async function setLocked(env: AccountEnv, username: string, locked: boolean): Promise<boolean> {
  const now = new Date().toISOString()
  const row = await env.DB.prepare('SELECT hash FROM accounts WHERE username = ?').bind(username).first<{ hash: string }>()
  const secret = secretAccounts(env).get(username)
  if (!row && !secret) return false
  if (!row) {
    if (locked) {
      await env.DB.prepare('INSERT INTO accounts (username, hash, disabled, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)')
        .bind(username, secret!, now)
        .run()
    }
  } else if (!locked && row.hash === secret) {
    // The row only existed to lock a secret account: drop it, so a later AUTH_USERS change applies again.
    await env.DB.prepare('DELETE FROM accounts WHERE username = ?').bind(username).run()
  } else {
    await env.DB.prepare('UPDATE accounts SET disabled = ?, updated_at = ? WHERE username = ?').bind(locked ? 1 : 0, now, username).run()
  }
  return true
}

/** Every account for the admin's list, locked ones included. */
export async function listAccounts(env: AccountEnv): Promise<AccountInfo[]> {
  const { results } = await env.DB.prepare('SELECT username, disabled FROM accounts ORDER BY created_at, rowid').all<{
    username: string
    disabled: number
  }>()
  const rows = new Map(results.map((r) => [r.username, r.disabled === 1]))
  const secret = secretAccounts(env)
  const admin = await adminUser(env)
  return [...new Set([...secret.keys(), ...rows.keys()])].map((username) => ({
    username,
    source: secret.has(username) ? 'secret' : 'app',
    disabled: rows.get(username) ?? false,
    admin: username === admin,
  }))
}

/* ------------------------------- invitations ------------------------------ */

// The table keeps a hash of each code, never the code: a leaked database cannot be used to join.
const inviteId = async (code: string) => b64url(await sha256(`invite:${code}`))

/** A one-time invitation code, valid for INVITE_DAYS. Only its hash is stored. */
export async function createInvite(env: AccountEnv, by: string): Promise<{ code: string; expiresAt: number }> {
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = Math.floor(Date.now() / 1000) + INVITE_DAYS * 86_400
  await env.DB.prepare('INSERT INTO invites (id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await inviteId(code), by, new Date().toISOString(), expiresAt)
    .run()
  return { code, expiresAt }
}

/** Invitations not used yet; expired ones are dropped on the way. */
export async function listInvites(env: AccountEnv): Promise<InviteInfo[]> {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now).run()
  const { results } = await env.DB.prepare('SELECT id, created_by, created_at, expires_at FROM invites ORDER BY created_at').all<{
    id: string
    created_by: string
    created_at: string
    expires_at: number
  }>()
  return results.map((r) => ({ id: r.id, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at }))
}

export async function revokeInvite(env: AccountEnv, id: string): Promise<boolean> {
  const { meta } = await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(id).run()
  return meta.changes === 1
}

/** Makes an account with an invitation and uses the invitation up. */
export async function joinWithInvite(env: AccountEnv, code: string, username: string, password: string): Promise<'ok' | 'invalid' | 'taken'> {
  const id = await inviteId(code)
  const now = Math.floor(Date.now() / 1000)
  const valid = await env.DB.prepare('SELECT 1 AS one FROM invites WHERE id = ? AND expires_at > ?').bind(id, now).first()
  if (!valid) return 'invalid'
  if (await usernameTaken(env, username)) return 'taken'
  const hash = await hashPassword(password)
  // Taking the row first makes the code single-use even when two requests race.
  const invite = await env.DB.prepare('DELETE FROM invites WHERE id = ? AND expires_at > ? RETURNING created_by, created_at, expires_at')
    .bind(id, now)
    .first<{ created_by: string; created_at: string; expires_at: number }>()
  if (!invite) return 'invalid'
  const stamp = new Date().toISOString()
  try {
    await env.DB.prepare('INSERT INTO accounts (username, hash, disabled, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)')
      .bind(username, hash, stamp)
      .run()
  } catch {
    // The name was taken in the meantime: give the invitation back.
    await env.DB.prepare('INSERT OR IGNORE INTO invites (id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(id, invite.created_by, invite.created_at, invite.expires_at)
      .run()
    return 'taken'
  }
  return 'ok'
}

/* --------------------------------- signing -------------------------------- */

/** Sessions and signed links need a session secret that is not empty or trivially short. */
export function secretConfigured(env: { SESSION_SECRET?: string }): boolean {
  return (env.SESSION_SECRET?.length ?? 0) >= MIN_SECRET
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!secretConfigured(env)) throw new Error('SESSION_SECRET is missing or shorter than 16 characters')
  // Changing AUTH_USERS (a new password) invalidates every session and signed link.
  const secret = `${env.SESSION_SECRET}:${env.AUTH_USERS ?? ''}`
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function sign(env: Env, payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload)))
}

/** The signed text also covers the account's password stamp: a new password or a lock ends every older token. */
const stamped = (payload: string, stamp: string) => (stamp ? `${payload}:${stamp}` : payload)

/** Tokens are "<user>.<exp>.<signature>"; returns the user when the signature over `payload(user, exp)` holds. */
async function verifyToken(env: Env, token: string | undefined, payload: (user: string, exp: number) => string): Promise<string | null> {
  if (!token || !secretConfigured(env)) return null
  const [user, expRaw, sig] = token.split('.')
  const exp = Number(expRaw)
  if (!user || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return null
  const account = await findAccount(env, user)
  if (!account) return null
  const expected = await sign(env, stamped(payload(user, exp), account.stamp))
  if (expected.length !== sig.length || !crypto.subtle.timingSafeEqual(encoder.encode(expected), encoder.encode(sig))) return null
  return user
}

async function makeToken(env: Env, user: string, ttlSeconds: number, payload: (user: string, exp: number) => string) {
  const account = await findAccount(env, user)
  if (!account) throw new Error('No such account')
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${user}.${exp}.${await sign(env, stamped(payload(user, exp), account.stamp))}`
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

/**
 * The address for links and visitors: https://CANONICAL_HOST when it is set, else the one the request came in on
 * (local dev, workers.dev). A deployment that moved to a new domain keeps serving the old one for existing connectors.
 */
export function siteOrigin(env: { CANONICAL_HOST?: string }, requestUrl: string): string {
  const here = new URL(requestUrl)
  const host = env.CANONICAL_HOST?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host || isLocalRequest(requestUrl)) return here.origin
  return `https://${host}`
}

/**
 * Each account's MCP connector token. The primary account's is the MCP_TOKEN secret itself (its connector URL
 * predates accounts); every other account's is derived from it, so changing MCP_TOKEN replaces them all.
 */
export async function connectorToken(env: Env, user: string): Promise<string | null> {
  const secret = env.MCP_TOKEN
  if (!secret || secret.length < 24) return null
  if (user === primaryUser(env)) return secret
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(`connector:${user}`)))
}

/** The account a connector token belongs to (locked accounts have none), or null; compared in constant time. */
export async function connectorUser(env: Env, candidate: string | undefined): Promise<string | null> {
  if (!candidate) return null
  const wanted = await sha256(candidate)
  let found: string | null = null
  for (const user of await accountNames(env)) {
    const token = await connectorToken(env, user)
    if (token && crypto.subtle.timingSafeEqual(wanted, await sha256(token))) found = user
  }
  return found
}
