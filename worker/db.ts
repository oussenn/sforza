import { blankMaster } from '@shared/seed'
import type { Application, BoardColumn, ChangeStamps, Library, Resume, SearchProfile } from '@shared/types'
import { applicationWithoutEmDashes, cleanBoardColumns, cleanSearchProfile, cvWithoutEmDashes, defaultSearchProfile, uid } from '@shared/utils'
import { primaryUser } from './auth'

/**
 * Every read and write is scoped to one account: pass the request's env, which carries the signed-in user
 * as OWNER (see forOwner). A missing owner throws instead of falling back to someone else's data.
 */
export type Store = { DB: D1Database; OWNER?: string; AUTH_USERS?: string; PRIMARY_USER?: string }

/** The env of one request, scoped to `owner`; the bindings stay reachable through the prototype. */
export function forOwner<E extends Env>(env: E, owner: string): E & { OWNER: string } {
  return Object.create(env, { OWNER: { value: owner, enumerable: false } }) as E & { OWNER: string }
}

export function ownerOf(s: Store): string {
  if (!s.OWNER) throw new Error('No account for this request')
  return s.OWNER
}

/** Settings rows of the primary account keep their original keys; other accounts' keys carry the username. */
const settingKey = (s: Store, name: string) => (ownerOf(s) === primaryUser(s) ? name : `${ownerOf(s)}:${name}`)

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    is_main INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Cost of paid AI calls per UTC day (spending cap, see budget.ts)
  `CREATE TABLE IF NOT EXISTS ai_spend (
    day TEXT PRIMARY KEY,
    usd REAL NOT NULL,
    calls INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Failed logins per address and per account (see auth.ts)
  `CREATE TABLE IF NOT EXISTS login_guard (
    key TEXT PRIMARY KEY,
    fails INTEGER NOT NULL,
    locked_until INTEGER NOT NULL
  )`,
  // Accounts made in the app and passwords changed in it, as PBKDF2 hashes; a row wins over AUTH_USERS (auth.ts)
  `CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // One-time invitations, by the SHA-256 of their code (the code itself is never stored)
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
]

// Rows from before accounts existed belong to the primary account.
const OWNED_TABLES = ['resumes', 'applications']

let ready: Promise<void> | null = null

/** Creates the tables on first use (once per isolate). Each account gets its master CV in ensureAccount. */
export function ensureDb(env: Pick<Env, 'DB' | 'AUTH_USERS' | 'PRIMARY_USER'>): Promise<void> {
  ready ??= init(env).catch((err) => {
    ready = null
    throw err
  })
  return ready
}

async function init(env: Pick<Env, 'DB' | 'AUTH_USERS' | 'PRIMARY_USER'>) {
  const db = env.DB
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
  for (const table of OWNED_TABLES) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
    if (results.some((c) => c.name === 'owner')) continue
    const owner = primaryUser(env).replace(/[^a-z0-9_-]/g, '')
    await db.batch([
      db.prepare(`ALTER TABLE ${table} ADD COLUMN owner TEXT NOT NULL DEFAULT '${owner}'`),
      db.prepare(`CREATE INDEX IF NOT EXISTS ${table}_owner ON ${table} (owner)`),
    ])
  }
}

// CVs, letters and form answers never carry an em dash (noEmDash): cleaned when saved, and when read, so documents
// saved before the rule are clean everywhere too (editor, PDFs, connector, detectors).

function insertStatement(db: D1Database, owner: string, r: Resume) {
  const { isMain, ...rest } = cvWithoutEmDashes(r)
  return db
    .prepare(
      'INSERT OR IGNORE INTO resumes (id, owner, name, kind, is_main, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(r.id, owner, r.name, r.kind, isMain ? 1 : 0, JSON.stringify(rest), r.createdAt, r.updatedAt)
}

const started = new Set<string>()

/** Gives a new account an empty master CV on its first request (checked once per isolate). */
export async function ensureAccount(s: Store): Promise<void> {
  const owner = ownerOf(s)
  if (started.has(owner)) return
  const row = await s.DB.prepare('SELECT COUNT(*) AS n FROM resumes WHERE owner = ?').bind(owner).first<{ n: number }>()
  if (row && row.n === 0) await insertStatement(s.DB, owner, blankMaster(uid('cv'), new Date().toISOString())).run()
  started.add(owner)
}

interface Row {
  id: string
  is_main: number
  data: string
}

function fromRow(row: Row): Resume {
  const data = cvWithoutEmDashes(JSON.parse(row.data) as Omit<Resume, 'isMain'>)
  return { ...data, id: row.id, isMain: row.is_main === 1 }
}

export async function listResumes(s: Store): Promise<Resume[]> {
  const { results } = await s.DB.prepare(
    "SELECT id, is_main, data FROM resumes WHERE owner = ? ORDER BY kind = 'master' DESC, updated_at DESC",
  )
    .bind(ownerOf(s))
    .all<Row>()
  return results.map(fromRow)
}

export async function getResume(s: Store, id: string): Promise<Resume | null> {
  const row = await s.DB.prepare('SELECT id, is_main, data FROM resumes WHERE id = ? AND owner = ?')
    .bind(id, ownerOf(s))
    .first<Row>()
  return row ? fromRow(row) : null
}

export async function getMainResume(s: Store): Promise<Resume | null> {
  const owner = ownerOf(s)
  const row =
    (await s.DB.prepare('SELECT id, is_main, data FROM resumes WHERE owner = ? AND is_main = 1 LIMIT 1')
      .bind(owner)
      .first<Row>()) ??
    (await s.DB.prepare(
      "SELECT id, is_main, data FROM resumes WHERE owner = ? ORDER BY kind = 'master' DESC, created_at ASC LIMIT 1",
    )
      .bind(owner)
      .first<Row>())
  return row ? fromRow(row) : null
}

export async function createResume(s: Store, resume: Resume): Promise<void> {
  await insertStatement(s.DB, ownerOf(s), resume).run()
}

export async function saveResume(s: Store, resume: Resume): Promise<void> {
  const { isMain: _ignored, ...rest } = cvWithoutEmDashes(resume)
  await s.DB.prepare('UPDATE resumes SET name = ?, kind = ?, data = ?, updated_at = ? WHERE id = ? AND owner = ?')
    .bind(resume.name, resume.kind, JSON.stringify(rest), resume.updatedAt, resume.id, ownerOf(s))
    .run()
}

export async function deleteResume(s: Store, id: string): Promise<void> {
  await s.DB.prepare('DELETE FROM resumes WHERE id = ? AND owner = ?').bind(id, ownerOf(s)).run()
}

export async function setMain(s: Store, id: string): Promise<void> {
  await s.DB.prepare('UPDATE resumes SET is_main = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE owner = ?')
    .bind(id, ownerOf(s))
    .run()
}

/* --------------------------------- changes -------------------------------- */

const SETTING_NAMES = ['library', 'search_profile', 'board_columns']

/**
 * One short stamp per area of the account (CVs, board, settings): its row count and latest change. Open pages
 * compare them to notice changes made elsewhere (the connector, another tab) and reload only that area.
 */
export async function changeStamps(s: Store): Promise<ChangeStamps> {
  const owner = ownerOf(s)
  const keys = SETTING_NAMES.map((name) => settingKey(s, name))
  const count = 'SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM'
  const [resumes, applications, settings] = await s.DB.batch<{ n: number; at: string | null }>([
    s.DB.prepare(`${count} resumes WHERE owner = ?`).bind(owner),
    s.DB.prepare(`${count} applications WHERE owner = ?`).bind(owner),
    s.DB.prepare(`${count} settings WHERE key IN (${keys.map(() => '?').join(', ')})`).bind(...keys),
  ])
  const stamp = (r: D1Result<{ n: number; at: string | null }>) => `${r.results[0]?.n ?? 0}:${r.results[0]?.at ?? ''}`
  return { resumes: stamp(resumes), applications: stamp(applications), settings: stamp(settings) }
}

async function getSetting(s: Store, name: string): Promise<string | null> {
  const row = await s.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(settingKey(s, name)).first<{ value: string }>()
  return row?.value ?? null
}

async function putSetting(s: Store, name: string, value: string): Promise<void> {
  await s.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(settingKey(s, name), value, new Date().toISOString())
    .run()
}

export async function getLibrary(s: Store): Promise<Library> {
  const raw = await getSetting(s, 'library')
  const lib = raw ? (JSON.parse(raw) as Partial<Library>) : {}
  return {
    projects: lib.projects ?? [],
    skills: lib.skills ?? [],
    experience: lib.experience ?? [],
    certifications: lib.certifications ?? [],
    notes: lib.notes ?? '',
  }
}

export async function saveLibrary(s: Store, lib: Library): Promise<void> {
  await putSetting(s, 'library', JSON.stringify(lib))
}

export async function getSearchProfile(s: Store): Promise<SearchProfile> {
  const raw = await getSetting(s, 'search_profile')
  if (raw) return cleanSearchProfile(JSON.parse(raw))
  return cleanSearchProfile(defaultSearchProfile())
}

export async function saveSearchProfile(s: Store, profile: SearchProfile): Promise<void> {
  await putSetting(s, 'search_profile', JSON.stringify(profile))
}

/** The columns this account added to its board, in order. */
export async function getBoardColumns(s: Store): Promise<BoardColumn[]> {
  const raw = await getSetting(s, 'board_columns')
  return raw ? cleanBoardColumns(JSON.parse(raw)) : []
}

export async function saveBoardColumns(s: Store, columns: BoardColumn[]): Promise<void> {
  await putSetting(s, 'board_columns', JSON.stringify(columns))
}

/* Images are shared between accounts: photo ids are random and logo ids are content hashes. */

export async function getAsset(s: Store, id: string) {
  return s.DB.prepare('SELECT mime, data FROM assets WHERE id = ?').bind(id).first<{ mime: string; data: string }>()
}

export async function putAsset(s: Store, id: string, mime: string, base64: string): Promise<void> {
  // Ids of fetched logos are content hashes, so the same image is stored once.
  await s.DB.prepare('INSERT OR IGNORE INTO assets (id, mime, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, mime, base64, new Date().toISOString())
    .run()
}

/* ------------------------------ applications ------------------------------ */

export async function listApplications(s: Store): Promise<Application[]> {
  const { results } = await s.DB.prepare('SELECT data FROM applications WHERE owner = ? ORDER BY created_at DESC')
    .bind(ownerOf(s))
    .all<{ data: string }>()
  return results.map((r) => applicationWithoutEmDashes(JSON.parse(r.data) as Application))
}

export async function getApplication(s: Store, id: string): Promise<Application | null> {
  const row = await s.DB.prepare('SELECT data FROM applications WHERE id = ? AND owner = ?')
    .bind(id, ownerOf(s))
    .first<{ data: string }>()
  return row ? applicationWithoutEmDashes(JSON.parse(row.data) as Application) : null
}

export async function putApplication(s: Store, app: Application): Promise<void> {
  // The WHERE stops an id that belongs to another account from being overwritten.
  await s.DB.prepare(
    `INSERT INTO applications (id, owner, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
     WHERE applications.owner = excluded.owner`,
  )
    .bind(app.id, ownerOf(s), JSON.stringify(applicationWithoutEmDashes(app)), app.createdAt, app.updatedAt)
    .run()
}

/**
 * Deletes a card (its letters live on it) and its tailored CV, unless that CV is the master or another card uses it.
 * Returns the id of the deleted CV, if any.
 */
export async function deleteApplication(s: Store, id: string, { keepCv = false } = {}): Promise<string | null> {
  const app = await getApplication(s, id)
  await s.DB.prepare('DELETE FROM applications WHERE id = ? AND owner = ?').bind(id, ownerOf(s)).run()
  if (!app?.resumeId || keepCv) return null
  const resume = await getResume(s, app.resumeId)
  if (!resume || resume.kind === 'master' || (await listApplications(s)).some((a) => a.resumeId === resume.id)) return null
  await deleteResume(s, resume.id)
  return resume.id
}
