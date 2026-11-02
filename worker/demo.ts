import seed from './demo-seed.json'

/**
 * The public demo. Signing in as "demo" with DEMO_PASSWORD never opens a shared account: every sign-in gets its own
 * sandbox, a fresh copy of the fictional sample data (Alex Morgan) under a random owner id, deleted after SANDBOX_TTL.
 * Visitors cannot see or spoil each other's data, and nothing they write reaches anyone else.
 *
 * What a sandbox may do is an allow-list (DEMO_ROUTES): the editor, the board, letters, the knowledge base and the
 * job search profile. Everything that costs money, reaches outside or is shared stays off: AI calls, the AI
 * detector, PDF rendering, link reading and logo fetching, image uploads (the assets table is shared), the MCP
 * connector, passwords and accounts.
 *
 * Abuse limits, all enforced in D1 so they hold across every Worker instance:
 * - wrong demo passwords count against the address like any failed sign-in (5, then a 15-minute lock);
 * - new sandboxes: PER_IP_HOUR per address and hour, MAX_ACTIVE at once, MAX_PER_DAY a day, claimed in one statement;
 * - writes: MAX_WRITES per sandbox, each body at most MAX_BODY bytes, at most MAX_CVS CVs and MAX_CARDS cards.
 * So the storage a stranger can fill is bounded (MAX_ACTIVE sandboxes of bounded size) and disappears within hours,
 * and the demo's share of D1 writes stays small next to the free daily allowance, so it cannot starve real accounts.
 * A signed-in demo request costs nothing extra to authenticate (an HMAC, no database read); only writes pay one
 * counter update.
 */

export const DEMO_USER = 'demo'
/** Owner ids of sandboxes. "~" never occurs in a real username (USERNAME_PATTERN), so they cannot collide. */
const PREFIX = 'demo~'

export const SANDBOX_TTL = 2 * 3600
const PER_IP_HOUR = 3
const MAX_ACTIVE = 20
const MAX_PER_DAY = 60
const MAX_WRITES = 400
const MAX_BODY = 300_000
const MAX_CVS = 12
const MAX_CARDS = 40
const KEEP_ROWS = 24 * 3600 // sandbox rows stay a day after creation (data long gone) to count the daily limit

type DemoEnv = { DB: D1Database; DEMO_PASSWORD?: string; SESSION_SECRET?: string }

/** The demo is on only when DEMO_PASSWORD is set (8+ characters); removing it ends every demo session at once. */
export const demoEnabled = (env: { DEMO_PASSWORD?: string }) => (env.DEMO_PASSWORD?.length ?? 0) >= 8
export const isDemoOwner = (owner: string | null | undefined): owner is string => !!owner && owner.startsWith(PREFIX)

export const NOT_IN_DEMO = 'Not available in the demo. Get your own copy of Sforza from GitHub to use it.'

const nowSec = () => Math.floor(Date.now() / 1000)
const encoder = new TextEncoder()

async function hashHex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The address is stored only as a keyed hash, enough to count sandboxes per address. */
const ipKey = (env: DemoEnv, ip: string) => hashHex(`demo-ip:${env.SESSION_SECRET ?? ''}:${ip}`).then((h) => h.slice(0, 32))

const TABLE = `CREATE TABLE IF NOT EXISTS demo_sandboxes (
  owner TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  writes INTEGER NOT NULL DEFAULT 0,
  purged INTEGER NOT NULL DEFAULT 0
)`
export const DEMO_SCHEMA = [TABLE, 'CREATE INDEX IF NOT EXISTS demo_sandboxes_ip ON demo_sandboxes (ip, created_at)']

/* -------------------------------- sandboxes ------------------------------- */

export type DemoStart = { owner: string; expiresAt: number } | { error: string }

/**
 * Claims a new sandbox for `ip` and fills it with the sample data. The limits are checked inside the INSERT itself,
 * so parallel sign-ins cannot slip past them.
 */
export async function startDemo(env: DemoEnv, ip: string): Promise<DemoStart> {
  await purgeExpired(env, 10)
  const now = nowSec()
  const owner = PREFIX + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('')
  const expiresAt = now + SANDBOX_TTL
  const key = await ipKey(env, ip)
  const { meta } = await env.DB.prepare(
    `INSERT INTO demo_sandboxes (owner, ip, created_at, expires_at)
     SELECT ?1, ?2, ?3, ?4
     WHERE (SELECT COUNT(*) FROM demo_sandboxes WHERE ip = ?2 AND created_at > ?3 - 3600) < ?5
       AND (SELECT COUNT(*) FROM demo_sandboxes WHERE expires_at > ?3) < ?6
       AND (SELECT COUNT(*) FROM demo_sandboxes WHERE created_at > ?3 - 86400) < ?7`,
  )
    .bind(owner, key, now, expiresAt, PER_IP_HOUR, MAX_ACTIVE, MAX_PER_DAY)
    .run()
  if (meta.changes !== 1) {
    const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM demo_sandboxes WHERE ip = ? AND created_at > ?')
      .bind(key, now - 3600)
      .first<{ n: number }>()
    return {
      error:
        (mine?.n ?? 0) >= PER_IP_HOUR
          ? 'You have started the demo several times in the last hour. Try again later.'
          : 'The demo is busy right now. Try again later.',
    }
  }
  await seedSandbox(env, owner)
  return { owner, expiresAt }
}

/** Copies the sample data into a sandbox. Record ids get the sandbox's suffix, since ids are unique across owners. */
async function seedSandbox(env: DemoEnv, owner: string): Promise<void> {
  const suffix = owner.slice(PREFIX.length, PREFIX.length + 10)
  const ids = [...seed.resumes.map((r) => r.id), ...seed.applications.map((a) => a.id)]
  const pattern = new RegExp(`\\b(${ids.join('|')})\\b`, 'g')
  const remap = (value: unknown) => JSON.stringify(value).replace(pattern, (id) => `${id}_${suffix}`)
  const stamp = new Date().toISOString()
  const db = env.DB
  await db.batch([
    ...seed.resumes.map((r) =>
      db
        .prepare('INSERT INTO resumes (id, owner, name, kind, is_main, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`${r.id}_${suffix}`, owner, r.name, r.kind, r.is_main, remap(r.data), r.created_at, stamp),
    ),
    ...seed.applications.map((a) =>
      db
        .prepare('INSERT INTO applications (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(`${a.id}_${suffix}`, owner, remap({ ...a.data, id: `${a.id}_${suffix}` }), a.created_at, stamp),
    ),
    ...Object.entries(seed.settings).map(([name, value]) =>
      db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind(`${owner}:${name}`, remap(value), stamp),
    ),
  ])
}

/** Ends a sandbox now (sign-out); its data goes with the next purge. */
export async function endDemo(env: DemoEnv, owner: string): Promise<void> {
  await env.DB.prepare('UPDATE demo_sandboxes SET expires_at = MIN(expires_at, ?) WHERE owner = ?').bind(nowSec(), owner).run()
}

/** Deletes the data of sandboxes that ran out (at most `limit` of them), and sandbox rows older than a day. */
export async function purgeExpired(env: DemoEnv, limit = 50): Promise<number> {
  const now = nowSec()
  const { results } = await env.DB.prepare('SELECT owner FROM demo_sandboxes WHERE purged = 0 AND expires_at <= ? LIMIT ?')
    .bind(now, limit)
    .all<{ owner: string }>()
  const db = env.DB
  for (const { owner } of results) {
    await db.batch([
      db.prepare('DELETE FROM resumes WHERE owner = ?').bind(owner),
      db.prepare('DELETE FROM applications WHERE owner = ?').bind(owner),
      // Every settings key of the sandbox starts with "<owner>:"; ";" is the character after ":".
      db.prepare('DELETE FROM settings WHERE key >= ? AND key < ?').bind(`${owner}:`, `${owner};`),
      db.prepare('UPDATE demo_sandboxes SET purged = 1 WHERE owner = ?').bind(owner),
    ])
  }
  await db.prepare('DELETE FROM demo_sandboxes WHERE purged = 1 AND created_at <= ?').bind(now - KEEP_ROWS).run()
  return results.length
}

/* --------------------------------- requests ------------------------------- */

const ID = '[A-Za-z0-9_-]{1,80}'
/** Everything a sandbox may call; every other /api route answers 403 for it. */
const DEMO_ROUTES: Record<string, RegExp[]> = {
  GET: [
    /^\/api\/(resumes|library|search-profile|applications|board-columns|changes|ai\/status)$/,
    new RegExp(`^/api/resumes/${ID}$`),
  ],
  PUT: [/^\/api\/(library|search-profile|board-columns)$/, new RegExp(`^/api/(resumes|applications)/${ID}$`)],
  POST: [/^\/api\/(resumes|applications|applications\/import)$/, new RegExp(`^/api/resumes/${ID}/main$`)],
  DELETE: [new RegExp(`^/api/(resumes|applications)/${ID}$`)],
}

export const demoRouteAllowed = (method: string, path: string) => (DEMO_ROUTES[method] ?? []).some((re) => re.test(path))

/**
 * Checks one write of a sandbox before it runs: body size, then the sandbox's write budget, which is also spent
 * here. Returns an error and status, or null when the write may go ahead.
 */
export async function demoWrite(env: DemoEnv, owner: string, bodyBytes: number): Promise<{ error: string; status: 413 | 429 } | null> {
  if (bodyBytes > MAX_BODY) return { error: 'Too large for the demo', status: 413 }
  const { meta } = await env.DB.prepare('UPDATE demo_sandboxes SET writes = writes + 1 WHERE owner = ? AND writes < ? AND expires_at > ? AND purged = 0')
    .bind(owner, MAX_WRITES, nowSec())
    .run()
  return meta.changes === 1 ? null : { error: 'This demo has reached its limit of changes. Sign in again for a fresh one.', status: 429 }
}

/** Row caps for creating CVs and cards in a sandbox. */
export async function demoRoomFor(env: DemoEnv, owner: string, kind: 'resumes' | 'applications'): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${kind} WHERE owner = ?`).bind(owner).first<{ n: number }>()
  return (row?.n ?? 0) < (kind === 'resumes' ? MAX_CVS : MAX_CARDS)
}
