import { beforeAll, describe, expect, it } from 'vitest'
import app from '../worker/index'
import { connectorToken, signPrintToken, signShare } from '../worker/auth'
import type { CustomSection, Resume, SkillsSection } from '../shared/types'
import { CV_RULES } from '../shared/utils'
import { memoryD1 } from './d1'

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

async function hash(password: string, salt: Uint8Array, iterations = 1000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

let env: Env
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext
const cookies: Record<string, string> = {}

interface Call extends RequestInit {
  as?: 'alice' | 'bob'
  ip?: string
  json?: unknown
  /** leave out X-Requested-With */
  bare?: boolean
}

function call(path: string, { as, ip = '198.51.100.1', json, bare, ...init }: Call = {}) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', ip)
  if (as) headers.set('Cookie', cookies[as])
  if (!bare) headers.set('X-Requested-With', 'fetch')
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(json)
  }
  return app.request(path, { ...init, headers }, env, ctx)
}

async function login(username: string, password: string, ip?: string) {
  return call('/api/auth/login', { method: 'POST', json: { username, password }, ip })
}

const sessionCookie = (res: Response) => res.headers.get('set-cookie')?.match(/rs_session=[^;]+/)?.[0] ?? ''

beforeAll(async () => {
  env = {
    DB: memoryD1(),
    AUTH_USERS: JSON.stringify({
      alice: await hash('correct horse', new Uint8Array(16).fill(1)),
      bob: await hash('battery staple', new Uint8Array(16).fill(2)),
    }),
    SESSION_SECRET: 'test-session-secret-0123456789',
    MCP_TOKEN: 'test-connector-token-0123456789abcdef',
  } as unknown as Env
  cookies.alice = sessionCookie(await login('alice', 'correct horse'))
  cookies.bob = sessionCookie(await login('bob', 'battery staple'))
})

describe('sign-in and sessions', () => {
  it('signs in and reports the account', async () => {
    expect(cookies.alice).toMatch(/^rs_session=alice\./)
    expect(await (await call('/api/auth/me', { as: 'alice' })).json()).toEqual({ authenticated: true, user: 'alice' })
  })

  it('moves visitors on an old address to CANONICAL_HOST, never local ones', async () => {
    const moved = { ...env, CANONICAL_HOST: 'cv.example.com' } as Env
    const get = (url: string) => app.request(url, { headers: { Cookie: cookies.alice } }, moved, ctx).then((r) => r.json())
    expect(await get('https://old.example.com/api/auth/me')).toEqual({ authenticated: true, user: 'alice', moveTo: 'https://cv.example.com' })
    expect(await get('https://cv.example.com/api/auth/me')).toEqual({ authenticated: true, user: 'alice' })
    expect(await get('http://localhost:5173/api/auth/me')).toEqual({ authenticated: true, user: 'alice' })
    expect(((await get('https://old.example.com/api/connector')) as { url: string }).url).toMatch(/^https:\/\/cv\.example\.com\/mcp\//)
  })

  it('refuses every account route without a session', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/resumes'],
      ['GET', '/api/applications'],
      ['GET', '/api/library'],
      ['GET', '/api/search-profile'],
      ['GET', '/api/board-columns'],
      ['GET', '/api/connector'],
      ['GET', '/api/pdf/cv_1'],
      ['PUT', '/api/library'],
      ['POST', '/api/applications'],
      ['DELETE', '/api/applications/app_1'],
      ['POST', '/api/ai/job-from-url'],
    ]
    for (const [method, path] of routes) {
      expect([method, path, (await call(path, { method, json: method === 'GET' || method === 'DELETE' ? undefined : {} })).status]).toEqual([method, path, 401])
    }
  })

  it('refuses a cookie whose account or signature was changed', async () => {
    const forged = cookies.alice.replace('rs_session=alice.', 'rs_session=bob.')
    expect((await call('/api/resumes', { headers: { Cookie: forged } })).status).toBe(401)
    expect((await call('/api/resumes', { headers: { Cookie: `${cookies.alice.slice(0, -3)}abc` } })).status).toBe(401)
  })

  it('needs X-Requested-With on every write, sign-in included', async () => {
    expect((await call('/api/auth/login', { method: 'POST', json: { username: 'alice', password: 'correct horse' }, bare: true })).status).toBe(400)
    expect((await call('/api/applications', { method: 'POST', json: { title: 'x' }, as: 'alice', bare: true })).status).toBe(400)
  })

  it('locks an address after five wrong passwords, not the account', { timeout: 20_000 }, async () => {
    for (let i = 0; i < 5; i++) expect((await login('alice', 'wrong', '203.0.113.9')).status).toBe(401)
    expect((await login('alice', 'correct horse', '203.0.113.9')).status).toBe(429)
    expect((await login('alice', 'correct horse', '203.0.113.10')).status).toBe(200)
  })

  it('refuses sign-in when the session secret is missing or short', async () => {
    const weak = { ...env, SESSION_SECRET: 'short' } as Env
    const res = await app.request(
      '/api/auth/login',
      { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'correct horse' }) },
      weak,
      ctx,
    )
    expect(res.status).toBe(500)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('accounts never see each other\'s data', () => {
  let card: string
  let aliceCv: string

  beforeAll(async () => {
    const created = await call('/api/applications', { method: 'POST', as: 'alice', json: { title: 'Data Analyst', company: 'Acme Logistics' } })
    card = ((await created.json()) as { id: string }).id
    aliceCv = ((await (await call('/api/resumes', { as: 'alice' })).json()) as { id: string }[])[0].id
    await call('/api/library', { method: 'PUT', as: 'alice', json: { projects: [], skills: [], experience: [], certifications: [], notes: 'alice private note' } })
  })

  it('board cards', async () => {
    const bobCards = (await (await call('/api/applications', { as: 'bob' })).json()) as { id: string }[]
    expect(bobCards.map((a) => a.id)).not.toContain(card)
    expect((await call(`/api/applications/${card}`, { method: 'PUT', as: 'bob', json: { title: 'taken over' } })).status).toBe(404)
    await call(`/api/applications/${card}`, { method: 'DELETE', as: 'bob' })
    const aliceCards = (await (await call('/api/applications', { as: 'alice' })).json()) as { id: string; title: string }[]
    expect(aliceCards.find((a) => a.id === card)?.title).toBe('Data Analyst')
  })

  it('CVs', async () => {
    const bobCvs = (await (await call('/api/resumes', { as: 'bob' })).json()) as { id: string }[]
    expect(bobCvs.map((r) => r.id)).not.toContain(aliceCv)
    expect((await call(`/api/resumes/${aliceCv}`, { as: 'bob' })).status).toBe(404)
    expect((await call(`/api/resumes/${aliceCv}`, { method: 'PUT', as: 'bob', json: { name: 'mine now' } })).status).toBe(404)
    expect((await call(`/api/resumes/${aliceCv}/main`, { method: 'POST', as: 'bob', json: {} })).status).toBe(404)
  })

  it('knowledge base', async () => {
    expect(((await (await call('/api/library', { as: 'alice' })).json()) as { notes: string }).notes).toBe('alice private note')
    expect(((await (await call('/api/library', { as: 'bob' })).json()) as { notes: string }).notes).toBe('')
  })

  it('print tokens only open the CV of the account they were signed for', async () => {
    const own = await call(`/api/print-data?id=${aliceCv}&token=${encodeURIComponent(await signPrintToken(env, 'alice', aliceCv))}`)
    expect(own.status).toBe(200)
    const bobToken = await signPrintToken(env, 'bob', aliceCv)
    expect((await call(`/api/print-data?id=${aliceCv}&token=${encodeURIComponent(bobToken)}`)).status).toBe(404)
    expect((await call(`/api/print-data?id=${aliceCv}&token=${encodeURIComponent(`${bobToken}x`)}`)).status).toBe(403)
  })

  it('share links only open the document and language they were signed for', async () => {
    const t = encodeURIComponent(await signShare(env, 'alice', 'cv', aliceCv, 'en'))
    expect((await call(`/api/share/cv/${aliceCv}?lang=de&t=${t}`)).status).toBe(403)
    expect((await call(`/api/share/letter/${aliceCv}?lang=en&t=${t}`)).status).toBe(403)
    expect((await call(`/api/share/cv/other?lang=en&t=${t}`)).status).toBe(403)
  })
})

describe('MCP connector', () => {
  const rpc = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, env, ctx)
  const tool = (name: string, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

  it('refuses missing and wrong tokens', async () => {
    expect((await rpc('/mcp', tool('list_applications'))).status).toBe(401)
    expect((await rpc('/mcp/not-a-real-token-0123456789', tool('list_applications'))).status).toBe(401)
    expect((await rpc('/mcp', tool('list_applications'), { Authorization: 'Bearer wrong' })).status).toBe(401)
  })

  it('scopes each connector to its own account', async () => {
    const bob = (await connectorToken(env, 'bob'))!
    const alice = (await connectorToken(env, 'alice'))!
    expect(bob).not.toBe(alice)
    const text = async (res: Response) => ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text
    expect(await text(await rpc(`/mcp/${bob}`, tool('list_applications')))).not.toContain('Acme Logistics')
    expect(await text(await rpc('/mcp', tool('get_profile'), { Authorization: `Bearer ${bob}` }))).not.toContain('alice private note')
    expect(await text(await rpc(`/mcp/${alice}`, tool('list_applications')))).toContain('Acme Logistics')
  })

  it('keeps working on an old address and links to CANONICAL_HOST', async () => {
    const moved = { ...env, CANONICAL_HOST: 'cv.example.com' } as Env
    const res = await app.request(
      `https://old.example.com/mcp/${(await connectorToken(env, 'alice'))!}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tool('get_profile')) },
      moved,
      ctx,
    )
    expect(res.status).toBe(200)
    const text = ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text
    expect(JSON.parse(text).editor).toBe('https://cv.example.com/edit')
    expect(text).not.toContain('old.example.com')
  })

  const asUser = async (user: string, name: string, args = {}) => {
    const res = await rpc(`/mcp/${(await connectorToken(env, user))!}`, tool(name, args))
    return JSON.parse(((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text)
  }
  const asAlice = (name: string, args = {}) => asUser('alice', name, args)
  /** The message of a tool call that fails. */
  const aliceError = async (name: string, args = {}) => {
    const res = await rpc(`/mcp/${(await connectorToken(env, 'alice'))!}`, tool(name, args))
    const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
    expect(result.isError).toBe(true)
    return result.content[0].text
  }

  it('gives every account the common CV rules and only its own CV rules', async () => {
    const own = 'Always list my certifications before education.'
    expect((await asAlice('save_search_profile', { profile: { cvRules: own } })).search_profile.cvRules).toBe(own)
    const alice = await asAlice('get_tailoring_material')
    expect(alice.rules).toContain(CV_RULES[0])
    expect(alice.rules).toContain(own)
    expect((await asAlice('get_letter_rules', { lang: 'en' })).rules).toContain(own)

    const bob = await asUser('bob', 'get_tailoring_material')
    expect(bob.rules).toContain(CV_RULES[0])
    expect(bob.rules).not.toContain(own)
    expect((await asUser('bob', 'get_letter_rules', { lang: 'en' })).rules).not.toContain("candidate's own rules")
  })

  it('edit_cv creates a section the CV lacks when an item is added to it', async () => {
    const out = await asAlice('edit_cv', { resume_id: 'master', add: [{ section: 'custom', fields: { title: 'Weekend coding club', description: 'Taught Python basics.' } }] })
    expect(out.changed).toContain('created the custom section')
    expect((await asAlice('get_cv', { resume_id: 'master' })).markdown).toContain('Weekend coding club')
  })

  it('edit_cv changes what the editor can: template, fonts, colours, icons, summary heading, item order', async () => {
    const added = await asAlice('edit_cv', {
      resume_id: 'master',
      add: [
        { section: 'custom', fields: { title: 'Chess club treasurer' } },
        { section: 'custom', fields: { title: 'Robotics team captain' } },
      ],
    })
    const [first, second] = (added.changed as string[]).flatMap((c) => c.match(/^added (\S+) to custom$/)?.[1] ?? [])
    const out = await asAlice('edit_cv', {
      resume_id: 'master',
      template: 'atlantic',
      style: { font: 'Lato', heading_font: 'Merriweather', background: '#fafafa', show_icons: false, photo_size: 90, font_size: 10, header_align: 'center' },
      sections: [{ type: 'summary', show_title: true }],
      items: [{ id: second, after: 'first' }],
    })
    expect(out.problems).toEqual([])
    expect(out.changed).toEqual(expect.arrayContaining(['template atlantic', `moved ${second}`]))

    // An agent sees the design in edit_cv's own names, hidden items included.
    const { resume_id, design } = await asAlice('get_cv', { resume_id: 'master' })
    expect(design.template).toBe('atlantic')
    expect(design.style).toMatchObject({ font: 'Lato', heading_font: 'Merriweather', background: '#fafafa', show_icons: false, photo_size: 90, font_size: 10, header_align: 'center' })
    expect(design.sections.find((s: { type: string }) => s.type === 'summary')).toMatchObject({ show_title: true })
    expect(design.sections.find((s: { type: string }) => s.type === 'custom').items.map((i: { id: string }) => i.id)[0]).toBe(second)

    const cv = (await (await call(`/api/resumes/${resume_id}`, { as: 'alice' })).json()) as Resume
    expect(cv.template).toBe('atlantic')
    expect(cv.style).toMatchObject({ font: 'Lato', headingFont: 'Merriweather', background: '#fafafa', showIcons: false, photoSize: 90, fontSize: 10, headerAlign: 'center' })
    const content = cv.content[cv.sourceLang]!
    expect(content.sections.find((s) => s.type === 'summary')).toMatchObject({ showTitle: true })
    const custom = content.sections.find((s) => s.type === 'custom') as CustomSection
    expect(custom.items.findIndex((i) => i.id === second)).toBeLessThan(custom.items.findIndex((i) => i.id === first))

    const bad = await aliceError('edit_cv', { resume_id: 'master', style: { font: 'Comic Sans' }, items: [{ id: first, after: 'nope' }] })
    expect(bad).toContain('Nothing to change')
    expect(bad).toContain('font must be one of')
    expect(bad).toContain('nope is not another item')
  })

  it('edit_cv writes the location per language, like the editor', async () => {
    const { resume_id, translatable_fields } = await asAlice('get_cv', { resume_id: 'master' })
    await asAlice('save_cv_translation', { resume_id, lang: 'de', fields: translatable_fields })
    await asAlice('edit_cv', { resume_id, personal: { location: 'Leipzig, Germany' } })
    await asAlice('edit_cv', { resume_id, lang: 'de', personal: { location: 'Leipzig, Deutschland' } })

    const { content } = (await (await call(`/api/resumes/${resume_id}`, { as: 'alice' })).json()) as Resume
    const where = (l: 'en' | 'de') => content[l]!.personal.contacts.find((c) => c.type === 'location')?.value
    expect(where('en')).toBe('Leipzig, Germany')
    expect(where('de')).toBe('Leipzig, Deutschland')

    // The location first, as the editor's arrows can do, in every language.
    await asAlice('edit_cv', { resume_id, personal: { order: ['location', 'phone'] } })
    const after = (await (await call(`/api/resumes/${resume_id}`, { as: 'alice' })).json()) as Resume
    for (const l of ['en', 'de'] as const) expect(after.content[l]!.personal.contacts[0]!.type).toBe('location')
  })

  it('get_cv in another language gives that language\'s text next to the source text', async () => {
    const { resume_id, translatable_fields } = await asAlice('get_cv', { resume_id: 'master' })
    const key = translatable_fields[0].k
    const fields = translatable_fields.map((f: { k: string; v: string }) => ({ k: f.k, v: f.k === key ? 'Auf Deutsch' : f.v }))
    await asAlice('save_cv_translation', { resume_id, lang: 'de', fields })

    const de = (await asAlice('get_cv', { resume_id, lang: 'de' })).translatable_fields
    const field = de.find((f: { k: string }) => f.k === key)
    expect(field.v).not.toBe('Auf Deutsch')
    expect(field.current).toBe('Auf Deutsch')
    expect((await asAlice('get_cv', { resume_id })).translatable_fields[0]).not.toHaveProperty('current')
  })

  it('edit_cv adds to the section that holds `after` when the CV has two of one type', async () => {
    const { resume_id } = await asAlice('get_cv', { resume_id: 'master' })
    const cv = (await (await call(`/api/resumes/${resume_id}`, { as: 'alice' })).json()) as Resume
    const sections = cv.content[cv.sourceLang]!.sections
    const skills = sections.find((s) => s.type === 'skills') as SkillsSection
    skills.items = [{ id: 'skill_sql', name: 'Data', details: 'SQL', level: 0 }]
    const courses: SkillsSection = { ...skills, id: 'sec_courses', title: 'Courses', items: [{ id: 'course_1', name: 'DataCamp', details: 'Intermediate SQL', level: 0 }] }
    sections.splice(sections.indexOf(skills), 0, courses)
    await call(`/api/resumes/${resume_id}`, { method: 'PUT', as: 'alice', json: cv })

    await asAlice('edit_cv', { resume_id, add: [{ section: 'skills', fields: { name: 'Cloud', details: 'Google Cloud' }, after: 'skill_sql' }] })
    const saved = (await (await call(`/api/resumes/${resume_id}`, { as: 'alice' })).json()) as Resume
    const [first, second] = saved.content[saved.sourceLang]!.sections.filter((s) => s.type === 'skills') as SkillsSection[]
    expect(first!.items.map((i) => i.name)).not.toContain('Cloud')
    expect(second!.items.at(-1)!.name).toBe('Cloud')

    // Its heading too: get_cv names each section's id.
    const ids = (await asAlice('get_cv', { resume_id })).design.sections.filter((s: { type: string }) => s.type === 'skills').map((s: { id: string }) => s.id)
    await asAlice('edit_cv', { resume_id, sections: [{ type: 'skills', id: ids[1], title: 'Technical Skills' }] })
    expect((await asAlice('get_cv', { resume_id })).markdown).toMatch(/## Courses[\s\S]*## Technical Skills/)
  })

  it("edit_cv design_from gives an older CV the master CV's design", async () => {
    await asAlice('edit_cv', { resume_id: 'master', template: 'mercury', style: { font: 'Inter', accent: '#2f7d4f' }, sections: [{ type: 'skills', placement: 'side' }] })
    const { resume_id: older } = await asAlice('copy_cv', { name: 'Older CV' })
    await asAlice('edit_cv', { resume_id: older, template: 'latex' })
    expect((await asAlice('get_cv', { resume_id: older })).design.template).toBe('latex')

    expect((await asAlice('edit_cv', { resume_id: older, design_from: 'master' })).changed).toContain('design of the master CV')
    const master = (await asAlice('get_cv', { resume_id: 'master' })).design
    const copy = (await asAlice('get_cv', { resume_id: older })).design
    expect(copy.template).toBe('mercury')
    expect(copy.style).toEqual(master.style)
    const placed = (d: { sections: { type: string; placement: string }[] }) => d.sections.map((s) => `${s.type}:${s.placement}`)
    expect(placed(copy)).toEqual(placed(master))
  })

  it("design_letter changes a card's letter template and style, and the print page uses them", async () => {
    const card = await asAlice('save_application', { title: 'Data Analyst', company: 'Acme Retail', stage: 'draft' })
    const body = 'Dear Hiring Team,\n\nI build dashboards.\n\nKind regards,'
    await asAlice('save_motivation_letter', { application_id: card.id, lang: 'en', subject: 'Application', body, enclosures: 'none' })

    const out = await asAlice('design_letter', { application_id: card.id, lang: 'en', template: 'banner', style: { font: 'Lora', accent: '#1E3A52', font_size: 30, line_height: 'tall' } })
    expect(out.changed).toEqual(['en template banner', 'font', 'accent', 'font_size'])
    expect(out.problems).toEqual(['line_height: "tall" is not allowed'])
    expect(out.style).toEqual({ font: 'Lora', accent: '#1e3a52', font_size: 13 })
    const app = await asAlice('get_application', { id: card.id })
    expect(app.letters.en.template).toBe('banner')
    expect(app.letter_style).toEqual(out.style)

    const token = encodeURIComponent(await signPrintToken(env, 'alice', `letter:${card.id}`))
    const print = (await (await call(`/api/print-letter?id=${card.id}&lang=en&token=${token}`)).json()) as { letter: { layout: string }; style: Record<string, unknown> }
    expect(print.letter.layout).toBe('banner')
    expect(print.style).toMatchObject({ font: 'Lora', accent: '#1e3a52', fontSize: 13 })

    // The editor saves the same style; anything invalid is dropped.
    await call(`/api/applications/${card.id}`, { method: 'PUT', as: 'alice', json: { letterStyle: { font: 'Comic Sans', paragraphGap: 0.8 } } })
    expect((await asAlice('get_application', { id: card.id })).letter_style).toEqual({ paragraph_gap: 0.8 })
    expect((await asAlice('design_letter', { application_id: card.id, match_cv: true })).style).toEqual({})
    expect(await aliceError('design_letter', { application_id: card.id, template: 'poster', lang: 'en' })).toContain('template must be one of')
  })

  it('keeps em dashes out of CVs, letters and form answers, whoever writes them', async () => {
    await asAlice('edit_cv', { resume_id: 'master', summary: 'Data analyst — I clean, model and report data.' })
    expect((await asAlice('get_cv', { resume_id: 'master' })).markdown).toContain('Data analyst, I clean, model and report data.')

    const card = await asAlice('save_application', { title: 'BI Analyst', company: 'Acme Retail', stage: 'draft' })
    await asAlice('save_motivation_letter', {
      application_id: card.id,
      lang: 'en',
      subject: 'Application — BI Analyst',
      body: 'Dear Hiring Team,\n\nI build dashboards — and I check the data behind them.\n\nKind regards,',
      enclosures: 'none',
    })
    await asAlice('save_form_answers', { application_id: card.id, answers: [{ question: 'Why us?', answer: 'Your data team — and your product.' }] })
    const saved = await asAlice('get_application', { id: card.id })
    expect(JSON.stringify(saved)).not.toContain('—')
    expect(saved.letters.en.body).toContain('I build dashboards, and I check the data behind them.')
  })

  it('fit_cv_to_page says when the page cannot be rendered instead of guessing', async () => {
    expect(await aliceError('fit_cv_to_page', { resume_id: 'master' })).toContain('The page fit is unavailable right now')
  })

  it('check_draft is ready only with a CV, a letter and both layouts measured', async () => {
    const card = await asAlice('save_application', { title: 'Data Analyst', company: 'Acme Freight', stage: 'draft' })
    const bare = await asAlice('check_draft', { application_id: card.id })
    expect(bare.ready).toBe(false)
    expect(bare.problems).toEqual([expect.stringContaining('No CV on the card'), expect.stringContaining('No motivation letter yet')])

    // Without a browser the page layout cannot be measured, and an unmeasured draft is never reported as ready.
    const { resume_id } = await asAlice('get_cv', { resume_id: 'master' })
    await asAlice('save_application', { id: card.id, resume_id })
    const withCv = await asAlice('check_draft', { application_id: card.id })
    expect(withCv.ready).toBe(false)
    expect(withCv.problems).toEqual(expect.arrayContaining([expect.stringContaining('CV en: layout check unavailable')]))
  })
})

describe('request limits and errors', () => {
  it('refuses bodies over 2.5 MB', async () => {
    const res = await call('/api/library', { method: 'PUT', as: 'alice', json: { notes: 'x'.repeat(3_000_000) } })
    expect(res.status).toBe(413)
  })

  it('answers malformed JSON with 400 and no internals', async () => {
    const res = await call('/api/applications', { method: 'POST', as: 'alice', headers: { 'Content-Type': 'application/json' }, body: '{"title":' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'The request body is not valid JSON' })
  })
})
