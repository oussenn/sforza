import type { AccessRequest } from '@shared/types'
import { secretId } from '@shared/utils'

/**
 * Requests for access from the sign-in page: an email address (and optionally a name and a few words), stored for
 * the admin, who answers with an invitation by mail or declines. One row per address: asking again only refreshes
 * it. The sign-in page always gets the same answer, so it never tells whether an address asked before.
 */

type Db = { DB: D1Database }

export const ACCESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    invite_id TEXT,
    username TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

/** Requests waiting at most: beyond this the form says requests are closed for now (it stops a flood of rows). */
const MAX_PENDING = 200
export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i

/** The fields of a request, trimmed and cut to size; a problem to show instead when the address is not usable. */
export function cleanRequest(body: Record<string, unknown>): { email: string; name: string; note: string } | { problem: string } {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '')
  const email = text(body.email, 254).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) return { problem: 'Enter a valid email address.' }
  return { email, name: text(body.name, 80), note: text(body.note, 500) }
}

/** Stores a request, or refreshes the pending one of that address. "full" when too many are waiting already. */
export async function requestAccess(env: Db, req: { email: string; name: string; note: string }): Promise<'ok' | 'full'> {
  const now = new Date().toISOString()
  const existing = await env.DB.prepare('SELECT status FROM access_requests WHERE email = ?').bind(req.email).first<{ status: string }>()
  if (existing) {
    if (existing.status === 'pending')
      await env.DB.prepare('UPDATE access_requests SET name = ?, note = ?, updated_at = ? WHERE email = ?').bind(req.name, req.note, now, req.email).run()
    return 'ok'
  }
  const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending'").first<{ n: number }>()
  if ((waiting?.n ?? 0) >= MAX_PENDING) return 'full'
  await env.DB.prepare(
    "INSERT OR IGNORE INTO access_requests (id, email, name, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
  )
    .bind(secretId('req'), req.email, req.name, req.note, now, now)
    .run()
  return 'ok'
}

interface Row {
  id: string
  email: string
  name: string
  note: string
  status: string
  username: string | null
  created_at: string
  updated_at: string
}

/** For the admin: waiting and invited requests, and the people who joined in the last 30 days, newest first. */
export async function listAccessRequests(env: Db): Promise<AccessRequest[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { results } = await env.DB.prepare(
    "SELECT * FROM access_requests WHERE status != 'joined' OR updated_at >= ? ORDER BY created_at DESC LIMIT 200",
  )
    .bind(since)
    .all<Row>()
  return results.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    note: r.note,
    status: r.status === 'invited' || r.status === 'joined' ? r.status : 'pending',
    username: r.username ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export const pendingRequestCount = async (env: Db): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0

export async function getAccessRequest(env: Db, id: string): Promise<AccessRequest | null> {
  return (await listAccessRequests(env)).find((r) => r.id === id) ?? null
}

/** The invitation a request was last answered with, if it still waits. */
export async function inviteOf(env: Db, id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT invite_id FROM access_requests WHERE id = ? AND status = 'invited'").bind(id).first<{ invite_id: string | null }>()
  return row?.invite_id ?? null
}

/** The request was answered with the invitation `inviteId` (the hash the invites table keys it by). */
export async function markInvited(env: Db, id: string, inviteId: string): Promise<void> {
  await env.DB.prepare("UPDATE access_requests SET status = 'invited', invite_id = ?, updated_at = ? WHERE id = ?").bind(inviteId, new Date().toISOString(), id).run()
}

/** Someone joined with an invitation: the request it answered shows who they became. */
export async function markJoined(env: Db, inviteId: string, username: string): Promise<void> {
  await env.DB.prepare("UPDATE access_requests SET status = 'joined', username = ?, updated_at = ? WHERE invite_id = ?")
    .bind(username, new Date().toISOString(), inviteId)
    .run()
}

/** A revoked invitation puts its request back to waiting. */
export async function unmarkInvite(env: Db, inviteId: string): Promise<void> {
  await env.DB.prepare("UPDATE access_requests SET status = 'pending', invite_id = NULL, updated_at = ? WHERE invite_id = ? AND status = 'invited'")
    .bind(new Date().toISOString(), inviteId)
    .run()
}

export async function deleteAccessRequest(env: Db, id: string): Promise<boolean> {
  const { meta } = await env.DB.prepare('DELETE FROM access_requests WHERE id = ?').bind(id).run()
  return meta.changes === 1
}

/** The address an invitation answered, for the admin's list of open invitations. */
export async function inviteEmails(env: Db): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare("SELECT invite_id, email FROM access_requests WHERE status = 'invited' AND invite_id IS NOT NULL").all<{
    invite_id: string
    email: string
  }>()
  return new Map(results.map((r) => [r.invite_id, r.email]))
}

/**
 * At most `limit` calls per `windowSeconds` for one key (an address), counted in the login_guard table under its
 * own prefix, so it never adds to the sign-in lock. True while allowed.
 */
export async function withinLimit(d1: D1Database, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const row = await d1
    .prepare(
      `INSERT INTO login_guard (key, fails, locked_until) VALUES (?1, 1, ?2 + ?3)
       ON CONFLICT(key) DO UPDATE SET
         fails = CASE WHEN locked_until <= ?2 THEN 1 ELSE fails + 1 END,
         locked_until = CASE WHEN locked_until <= ?2 THEN ?2 + ?3 ELSE locked_until END
       RETURNING fails`,
    )
    .bind(key, now, windowSeconds)
    .first<{ fails: number }>()
  return (row?.fails ?? 1) <= limit
}
