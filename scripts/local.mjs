// Running Sforza on your own computer. npm runs the first one by itself before `npm run dev`:
//   node scripts/local.mjs prepare              makes .env from .env.example and gives it a random SESSION_SECRET when it
//                                               has none, then says which accounts this local copy has
//   npm run local:password -- <username>        a new password for a local account (an account of AUTH_USERS too), or
//                                               a new local account with that name; prints the password once
//   npm run local:reset -- --yes                deletes the local database: the next visit asks for the first account
// Only the local copy: nothing here reaches a deployed site.
import { spawnSync } from 'node:child_process'
import { webcrypto as crypto } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const at = (...parts) => path.join(ROOT, ...parts)
const D1_DIR = at('.wrangler', 'state', 'v3', 'd1')
const USERNAME = /^[a-z0-9_-]{2,32}$/
const ITERATIONS = 100_000 // as worker/auth.ts (the Workers runtime maximum for PBKDF2)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** The file the dev server reads its secrets from: .dev.vars when it exists (then .env is ignored), else .env. */
const envFile = () => (existsSync(at('.dev.vars')) ? '.dev.vars' : '.env')

function readVar(text, name) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') : ''
}

/** Usernames in AUTH_USERS of the env file, as the Worker reads them (wrangler unescapes \$). */
function secretUsers(text) {
  const raw = readVar(text, 'AUTH_USERS').replaceAll('\\$', '$')
  if (!raw) return []
  try {
    return Object.keys(JSON.parse(raw)).filter((u) => USERNAME.test(u))
  } catch {
    return []
  }
}

/** Accounts made in the app, read from the local database files (none before the first visit). */
async function appUsers() {
  if (!existsSync(D1_DIR)) return []
  const emit = process.emitWarning
  process.emitWarning = () => {} // node:sqlite says it is experimental
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const names = new Set()
    for (const dir of readdirSync(D1_DIR)) {
      for (const file of readdirSync(path.join(D1_DIR, dir)).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')) {
        try {
          const db = new DatabaseSync(path.join(D1_DIR, dir, file), { readOnly: true })
          for (const row of db.prepare('SELECT username, disabled FROM accounts').all()) names.add(row.disabled ? `${row.username} (locked)` : row.username)
          db.close()
        } catch {
          /* a database without the accounts table yet */
        }
      }
    }
    return [...names]
  } catch {
    return []
  } finally {
    process.emitWarning = emit
  }
}

async function prepare() {
  const name = envFile()
  if (!existsSync(at(name))) {
    copyFileSync(at('.env.example'), at('.env'))
    console.log('  Made .env from .env.example.')
  }
  let text = readFileSync(at(name), 'utf8')
  if (readVar(text, 'SESSION_SECRET').length < 16) {
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    text = /^SESSION_SECRET=.*$/m.test(text) ? text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`) : `${text.trimEnd()}\nSESSION_SECRET=${secret}\n`
    writeFileSync(at(name), text)
    console.log(`  Gave ${name} a random SESSION_SECRET (it signs your local sessions; keep it, or local sign-ins and saved API keys stop working).`)
  }
  const fromSecret = secretUsers(text)
  const fromApp = (await appUsers()).filter((u) => !fromSecret.includes(u.replace(/ \(locked\)$/, '')))
  const all = [...fromSecret, ...fromApp]
  if (!all.length) {
    console.log('  No account on this computer yet: open the site and create yours (the first account is the admin).')
  } else {
    const source = !fromSecret.length ? '' : fromApp.length ? ` (${fromSecret.join(', ')} from AUTH_USERS in ${name})` : ` (from AUTH_USERS in ${name})`
    console.log(`  Accounts on this computer: ${all.join(', ')}${source}.`)
    console.log('  Forgot a password? npm run local:password -- <username>   Start over? npm run local:reset -- --yes')
  }
}

function randomPassword() {
  const limit = 256 - (256 % ALPHABET.length)
  const pick = () => {
    for (;;) {
      const [b] = crypto.getRandomValues(new Uint8Array(1))
      if (b < limit) return ALPHABET[b % ALPHABET.length]
    }
  }
  return Array.from({ length: 4 }, () => Array.from({ length: 5 }, pick).join('')).join('-')
}

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)
  const b64 = (bytes) => Buffer.from(bytes).toString('base64url')
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`
}

/** The D1 database name of wrangler.jsonc, for `wrangler d1 execute --local`. */
const databaseName = () => /"database_name"\s*:\s*"([^"]+)"/.exec(readFileSync(at('wrangler.jsonc'), 'utf8'))?.[1]

function wrangler(args) {
  const bin = at('node_modules', 'wrangler', 'bin', 'wrangler.js')
  return spawnSync(process.execPath, [bin, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } })
}

async function password(username) {
  const user = (username ?? '').trim().toLowerCase()
  if (!USERNAME.test(user)) {
    console.error('Usage: npm run local:password -- <username>   (2 to 32 of a-z, 0-9, _ and -)')
    process.exit(1)
  }
  const known = [...secretUsers(existsSync(at(envFile())) ? readFileSync(at(envFile()), 'utf8') : ''), ...(await appUsers()).map((u) => u.replace(/ \(locked\)$/, ''))]
  const pass = randomPassword()
  const now = new Date().toISOString()
  // The same statement as setPassword in worker/auth.ts: a row in the accounts table wins over AUTH_USERS.
  const sql = `INSERT INTO accounts (username, hash, disabled, created_at, updated_at) VALUES ('${user}', '${await hash(pass)}', 0, '${now}', '${now}') ON CONFLICT(username) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`
  const run = wrangler(['d1', 'execute', databaseName(), '--local', '--command', sql])
  if (run.status !== 0) {
    const why = `${run.stderr}${run.stdout}`
    console.error(/no such table/i.test(why) ? 'The local database is not set up yet: run npm run dev and open the site once, then try again.' : why.trim())
    process.exit(1)
  }
  console.log(known.includes(user) ? `New password for ${user} on this computer:` : `Made the local account ${user}:`)
  console.log(`\n  ${user}  ${pass}\n`)
  console.log('Shown only now. Sign in with it at http://localhost:5173 (change it under Account if you like).')
}

function reset(confirmed) {
  if (!confirmed) {
    console.error('This deletes every CV, card and account of the local copy (not of a deployed site). Run: npm run local:reset -- --yes')
    process.exit(1)
  }
  try {
    rmSync(D1_DIR, { recursive: true, force: true })
  } catch (err) {
    console.error(`Could not delete ${D1_DIR}: stop npm run dev first. (${err.code ?? err.message})`)
    process.exit(1)
  }
  const users = existsSync(at(envFile())) ? secretUsers(readFileSync(at(envFile()), 'utf8')) : []
  console.log('Deleted the local database.')
  console.log(
    users.length
      ? `AUTH_USERS in ${envFile()} still has ${users.join(', ')}: they can sign in. For the "Create your account" page, remove the AUTH_USERS line too.`
      : 'The next visit to the site asks you to create the first account.',
  )
}

const [command, arg] = process.argv.slice(2)
if (command === 'prepare') await prepare()
else if (command === 'password') await password(arg)
else if (command === 'reset') reset(arg === '--yes' || process.argv.includes('--yes'))
else {
  console.error('Usage: node scripts/local.mjs prepare | password <username> | reset --yes')
  process.exit(1)
}
