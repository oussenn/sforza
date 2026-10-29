// Optional: accounts kept in the AUTH_USERS secret instead of being made in the app (first-run setup, invitations).
// A random password per username, hashed like worker/auth.ts expects.
//   node scripts/new-logins.mjs alice bob
// Writes logins.txt (usernames + passwords, for you) and auth-users.json (hashes only, for Cloudflare); both are
// gitignored. Then: npx wrangler secret put AUTH_USERS < auth-users.json   and delete both files once saved elsewhere.
import { webcrypto as crypto } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const ITERATIONS = 100_000 // the Workers runtime maximum for PBKDF2
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/l/I

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

function randomPassword() {
  // 4 groups of 5 from 55 symbols: about 115 bits, far beyond guessing.
  const pick = () => {
    const limit = 256 - (256 % ALPHABET.length)
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
  return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

const users = process.argv.slice(2).map((u) => u.toLowerCase())
if (!users.length || users.some((u) => !/^[a-z0-9_-]{2,32}$/.test(u))) {
  console.error('Usage: node scripts/new-logins.mjs <username> [username...]   (a-z, 0-9, _ and -)')
  process.exit(1)
}

const hashes = {}
const lines = []
for (const user of users) {
  const password = randomPassword()
  hashes[user] = await hash(password)
  lines.push(`${user}  ${password}`)
}
writeFileSync('logins.txt', `${lines.join('\n')}\n`)
writeFileSync('auth-users.json', JSON.stringify(hashes))
console.log(`Wrote logins.txt and auth-users.json for: ${users.join(', ')}`)
// Wrangler expands $name in .env files, so the line for local development escapes every $.
console.log(`\nFor local development, put this line in .env:\nAUTH_USERS=${JSON.stringify(hashes).replaceAll('$', '\\$')}`)
