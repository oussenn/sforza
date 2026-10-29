import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublic, isPublicIp, isPublicUrl, readCapped } from '../worker/net'
import { parseJobUrl } from '../worker/scrape'

describe('which links the server may open', () => {
  it('allows public web pages', () => {
    for (const url of ['https://careers.acme.com/jobs/1', 'http://jobs.acme.de:80/a?b=c', 'https://boards.greenhouse.io/acme/jobs/123', 'https://acme.com./x']) {
      expect([url, isPublicUrl(url)]).toEqual([url, true])
    }
  })

  it('refuses local names, IP addresses in any spelling, odd ports, credentials and other schemes', () => {
    for (const url of [
      'http://localhost/',
      'http://localhost./admin',
      'http://intranet/',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://017700000001/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://router.lan/',
      'http://printer.local/',
      'http://db.internal/',
      'http://nas.home.arpa/',
      'https://acme.com:8443/',
      'https://user:pw@acme.com/',
      'ftp://acme.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a link',
    ]) {
      expect([url, isPublicUrl(url)]).toEqual([url, false])
    }
  })

  it('parseJobUrl gives the reader a clear error', () => {
    expect(() => parseJobUrl('http://192.168.1.1/jobs')).toThrow('public web address')
    expect(parseJobUrl(' https://acme.com/jobs/1 ').hostname).toBe('acme.com')
  })
})

describe('which resolved addresses count as public', () => {
  it('public IPv4 and IPv6', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001::200e']) expect([ip, isPublicIp(ip)]).toEqual([ip, true])
  })

  it('private, loopback, link-local, shared, reserved and tunnelled ones', () => {
    for (const ip of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.169.254',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '::',
      '::1',
      'fe80::1',
      'fd00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2002:c0a8:101::1',
      '2001:db8::1',
      '2001:0:4136:e378::1',
      'not an ip',
    ]) {
      expect([ip, isPublicIp(ip)]).toEqual([ip, false])
    }
  })
})

describe('fetchPublic', () => {
  /** A fake internet: DNS answers per name and a handler per page. */
  function web(dns: Record<string, string[]>, pages: Record<string, () => Response>) {
    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input))
        if (url.hostname === 'cloudflare-dns.com') {
          const name = url.searchParams.get('name')!
          const v6 = url.searchParams.get('type') === 'AAAA'
          const ips = (dns[name] ?? []).filter((ip) => ip.includes(':') === v6)
          return Response.json({ Answer: ips.map((data) => ({ type: v6 ? 28 : 1, data })) })
        }
        fetched.push(url.toString())
        return pages[url.toString()]?.() ?? new Response('not found', { status: 404 })
      }),
    )
    return fetched
  }
  const redirect = (to: string) => () => new Response(null, { status: 302, headers: { Location: to } })

  afterEach(() => vi.unstubAllGlobals())

  it('follows redirects between public pages', async () => {
    web({ 'a.acme.com': ['93.184.216.34'], 'b.acme.com': ['2606:4700::6810:1'] }, {
      'https://a.acme.com/job': redirect('https://b.acme.com/job/1'),
      'https://b.acme.com/job/1': () => new Response('the posting'),
    })
    expect(await (await fetchPublic('https://a.acme.com/job')).text()).toBe('the posting')
  })

  it('stops a redirect to a local address before requesting it', async () => {
    const fetched = web({ 'c.acme.com': ['93.184.216.34'] }, { 'https://c.acme.com/job': redirect('http://127.0.0.1:8080/admin') })
    await expect(fetchPublic('https://c.acme.com/job')).rejects.toThrow('public web page')
    expect(fetched).toEqual(['https://c.acme.com/job'])
  })

  it('stops a redirect to a name that resolves to a private address', async () => {
    const fetched = web({ 'd.acme.com': ['93.184.216.34'], 'rebind.evil.net': ['93.184.216.35', '10.0.0.5'] }, {
      'https://d.acme.com/job': redirect('https://rebind.evil.net/'),
    })
    await expect(fetchPublic('https://d.acme.com/job')).rejects.toThrow('private address')
    expect(fetched).toEqual(['https://d.acme.com/job'])
  })

  it('never requests a name that resolves to a private or unknown address', async () => {
    const fetched = web({ 'nas.evil.net': ['192.168.0.10'], 'six.evil.net': ['fd12::1'] }, {})
    await expect(fetchPublic('https://nas.evil.net/')).rejects.toThrow('private address')
    await expect(fetchPublic('https://six.evil.net/')).rejects.toThrow('private address')
    await expect(fetchPublic('https://gone.evil.net/')).rejects.toThrow('Could not find')
    expect(fetched).toEqual([])
  })

  it('gives up on redirect loops', async () => {
    web({ 'loop.acme.com': ['93.184.216.34'] }, {
      'https://loop.acme.com/a': redirect('/b'),
      'https://loop.acme.com/b': redirect('/a'),
    })
    await expect(fetchPublic('https://loop.acme.com/a')).rejects.toThrow('too many')
  })

  it('reads bodies only up to the limit', async () => {
    const body = () => new Response('0123456789')
    expect(await readCapped(body(), 4)).toEqual({ bytes: new TextEncoder().encode('0123'), cut: true })
    expect(await readCapped(body(), 100)).toEqual({ bytes: new TextEncoder().encode('0123456789'), cut: false })
  })
})
