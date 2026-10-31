import type { Page } from '@cloudflare/puppeteer'
import { AiError } from './ai'

/**
 * Requests to addresses that come from users, job pages or agents. Only the public web is reachable: no IP
 * literals, local or internal names, odd ports or credentials in the link, and no names that resolve to a
 * private address. Redirects are followed by hand so every hop is checked again, and bodies are cut at a size
 * limit instead of being read whole. This matters most when the app runs on a laptop or a home network.
 */

const INTERNAL_NAMES = /(^|\.)(localhost|localdomain|local|internal|intranet|lan|home|corp|private|test|invalid|example|onion|home\.arpa)$/i

/** A link the server may open: http(s) on the default ports, a public-looking host name, no user or password. */
export function isPublicUrl(raw: string | URL): boolean {
  let url: URL
  try {
    url = typeof raw === 'string' ? new URL(raw) : raw
  } catch {
    return false
  }
  const host = url.hostname.replace(/\.$/, '')
  return (
    /^https?:$/.test(url.protocol) &&
    !url.username &&
    !url.password &&
    (url.port === '' || url.port === '80' || url.port === '443') &&
    host.includes('.') &&
    // The URL parser turns every IPv4 spelling (hex, octal, 2130706433) into dotted decimal; IPv6 keeps its brackets.
    !/^[\d.]+$/.test(host) &&
    !host.startsWith('[') &&
    !INTERNAL_NAMES.test(host)
  )
}

function publicV4([a, b, c]: number[]): boolean {
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

/** The eight 16-bit words of an IPv6 address, or null. */
function ipv6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number)
    s = `${s.slice(0, -tail[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, rest] = s.split('::')
  const parts = (x: string | undefined) => (x ? x.split(':') : [])
  const fill = rest === undefined ? 0 : 8 - parts(head).length - parts(rest).length
  if (fill < 0) return null
  const words = [...parts(head), ...Array<string>(fill).fill('0'), ...parts(rest)].map((w) => (/^[\da-f]{1,4}$/.test(w) ? parseInt(w, 16) : NaN))
  return words.length === 8 && words.every((w) => Number.isInteger(w)) ? words : null
}

/** Is this IPv4 or IPv6 address on the public internet? */
export function isPublicIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) return publicV4(v4.slice(1).map(Number))
  const w = ipv6Words(ip)
  if (!w) return false
  const embedded = [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses reach the IPv4 address they carry.
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return publicV4(embedded)
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return publicV4(embedded)
  // 6to4 carries one in its second and third word; Teredo (2001::/32) hides one, and documentation is not routed.
  if (w[0] === 0x2002) return publicV4([w[1] >> 8, w[1] & 255, w[2] >> 8])
  if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return false
  // Everything else outside global unicast (2000::/3) is loopback, link-local, unique-local or multicast.
  return (w[0] & 0xe000) === 0x2000
}

const verdicts = new Map<string, { problem: string | null; until: number }>()

async function lookup(name: string, type: 'A' | 'AAAA'): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null)
  if (!res?.ok) throw new AiError('Could not look up that address right now. Try again in a minute.')
  const data = (await res.json()) as { Answer?: { type: number; data: string }[] }
  return (data.Answer ?? []).filter((a) => a.type === (type === 'A' ? 1 : 28)).map((a) => a.data)
}

/**
 * Throws unless the name resolves, and only to public addresses. Asked over DNS over HTTPS, so a name that only
 * an office or home network knows counts as unknown; answers are kept for five minutes per isolate.
 */
async function assertPublicHost(host: string): Promise<void> {
  const name = host.toLowerCase().replace(/\.$/, '')
  let verdict = verdicts.get(name)
  if (!verdict || verdict.until < Date.now()) {
    const ips = (await Promise.all([lookup(name, 'A'), lookup(name, 'AAAA')])).flat()
    const problem = !ips.length ? 'Could not find that site. Check the link.' : ips.every(isPublicIp) ? null : 'That link points to a private address.'
    if (verdicts.size > 500) verdicts.clear()
    verdict = { problem, until: Date.now() + 5 * 60_000 }
    verdicts.set(name, verdict)
  }
  if (verdict.problem) throw new AiError(verdict.problem)
}

/** fetch() for outside links: public hosts only, each redirect checked again, at most five. */
export async function fetchPublic(raw: string | URL, init: RequestInit = {}): Promise<Response> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AiError('That does not look like a link.')
  }
  for (let hop = 0; ; hop++) {
    if (!isPublicUrl(url)) throw new AiError('That link does not point to a public web page.')
    await assertPublicHost(url.hostname)
    const res = await fetch(url.toString(), { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    await res.body?.cancel().catch(() => undefined)
    if (hop >= 5) throw new AiError('That link redirects too many times.')
    url = new URL(location, url)
  }
}

/** The body, cut after `max` bytes instead of being read whole. */
export async function readCapped(res: Response, max: number): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = res.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  const bytes = new Uint8Array(Math.min(size, max))
  let at = 0
  for (const chunk of chunks) {
    if (at >= bytes.length) break
    const part = chunk.subarray(0, bytes.length - at)
    bytes.set(part, at)
    at += part.length
  }
  return { bytes, cut: size > max }
}

export async function readText(res: Response, max: number): Promise<string> {
  return new TextDecoder().decode((await readCapped(res, max)).bytes)
}

/** Frames worth reading in a headless page: public pages and the blank or inline frames they create. */
export const isReadableFrame = (url: string) => /^(about|data|blob):/.test(url) || isPublicUrl(url)

/**
 * Headless Chrome: every document the page loads (itself, its frames, redirects and script navigations) must
 * come from a public host. Only documents are paused, so images and scripts load at normal speed.
 */
export async function guardPage(page: Page): Promise<void> {
  const cdp = await page.createCDPSession()
  cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    const allowed = /^(data|blob):/.test(request.url)
      ? Promise.resolve(true)
      : isPublicUrl(request.url)
        ? assertPublicHost(new URL(request.url).hostname).then(() => true, () => false)
        : Promise.resolve(false)
    void allowed
      .then((ok) => (ok ? cdp.send('Fetch.continueRequest', { requestId }) : cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })))
      .catch(() => undefined)
  })
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] })
}
