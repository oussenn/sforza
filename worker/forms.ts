import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer'
import type { FormAnswer } from '@shared/types'
import { AiError } from './ai'
import { fetchPublic, guardPage, isPublicUrl, isReadableFrame, readText } from './net'

/**
 * Online application forms: the questions of a Greenhouse form (read from its public job-board API, also when
 * the form is embedded in a company career page with ?gh_jid=), and the saved answers the user copies into it.
 */

type Json = Record<string, unknown>

interface FormQuestion {
  question: string
  required: boolean
  /** text, long text, file, single choice, multiple choice */
  type: string
  /** the options of a choice question (a long list is cut, see options_total) */
  options?: string[]
  options_total?: number
}

export interface ApplicationForm {
  /** "Greenhouse", or the host of the form */
  ats: string
  /** the page the form is on (after following the Apply button) */
  url: string
  questions: FormQuestion[]
  note?: string
}

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; sforza)', Accept: 'application/json' }

const FIELD_TYPES: Record<string, string> = {
  input_text: 'text',
  textarea: 'long text',
  input_file: 'file',
  input_hidden: 'hidden',
  multi_value_single_select: 'single choice',
  multi_value_multi_select: 'multiple choice',
}

/** Application-form answers from untrusted input. */
export function formAnswersField(value: unknown): FormAnswer[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is Json => !!v && typeof v === 'object' && typeof (v as Json).question === 'string' && !!((v as Json).question as string).trim())
    .map((v) => {
      const note = typeof v.note === 'string' ? v.note.trim().slice(0, 1000) : ''
      return {
        question: (v.question as string).trim().slice(0, 1000),
        answer: typeof v.answer === 'string' ? v.answer.slice(0, 10_000) : '',
        ...(note ? { note } : {}),
      }
    })
    .slice(0, 80)
}

async function json(url: string): Promise<Json | null> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) }).catch(() => null)
  return res?.ok ? ((await res.json().catch(() => null)) as Json | null) : null
}

/** Greenhouse board token and job id from a board link, or the job id of a career page that embeds the form. */
function greenhouseRef(url: URL): { board?: string; job: string; eu: boolean } | null {
  const eu = url.hostname.includes('.eu.greenhouse.io')
  const path = url.hostname.endsWith('greenhouse.io') ? url.pathname.match(/^\/([\w-]+)\/jobs\/(\d+)/) : null
  if (path) return { board: path[1], job: path[2], eu }
  const job = url.searchParams.get('gh_jid') ?? (url.hostname.endsWith('greenhouse.io') ? url.searchParams.get('token') : null)
  if (!job || !/^\d+$/.test(job)) return null
  return { board: url.searchParams.get('for') ?? undefined, job, eu }
}

/** Board tokens to try for a career page on the company's own domain. */
async function boardCandidates(url: URL, company: string): Promise<string[]> {
  const found: string[] = []
  const res = await fetchPublic(url, { headers: { ...HEADERS, Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) }).catch(() => null)
  const html = res?.ok ? await readText(res, 2_000_000).catch(() => '') : ''
  for (const m of html.matchAll(/greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|embed\/job_app\?for=|v1\/boards\/)([\w-]+)/g)) found.push(m[1])
  const domain = url.hostname.split('.').slice(-2, -1)[0]
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '')
  return [...new Set([...found, domain, slug].filter(Boolean))]
}

function question(q: Json): FormQuestion | null {
  const fields = Array.isArray(q.fields) ? (q.fields as Json[]) : []
  const types = fields.map((f) => FIELD_TYPES[String(f.type)] ?? String(f.type)).filter((t) => t !== 'hidden')
  if (!types.length || typeof q.label !== 'string') return null
  const options = fields.flatMap((f) => (Array.isArray(f.values) ? (f.values as Json[]).map((v) => String(v.label ?? '')) : [])).filter(Boolean)
  const label = q.label.replace(/\s+/g, ' ').trim()
  return {
    question: label,
    required: q.required === true,
    // Resume and cover letter take a file or pasted text.
    type: types.includes('file') ? 'file (or pasted text)' : types[0],
    ...(options.length ? { options: options.slice(0, 40), ...(options.length > 40 ? { options_total: options.length } : {}) } : {}),
  }
}

/**
 * The questions of an application form: Greenhouse from its API, any other public form by opening it in
 * headless Chrome (clicking the page's Apply button when the form is not on it yet). Null when no form shows.
 */
export async function readApplicationForm(raw: string, company: string, env?: Pick<Env, 'BROWSER'>): Promise<ApplicationForm | null> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!isPublicUrl(url)) throw new AiError('Use the public web address of the application form.')
  const ref = greenhouseRef(url)
  if (ref) {
    const form = await greenhouseForm(url, ref, company)
    if (form) return form
  }
  return env?.BROWSER && /^https?:$/.test(url.protocol) ? renderedForm(env.BROWSER, url) : null
}

async function greenhouseForm(url: URL, ref: { board?: string; job: string; eu: boolean }, company: string): Promise<ApplicationForm | null> {
  const boards = ref.board ? [ref.board] : await boardCandidates(url, company)
  for (const board of boards) {
    for (const host of ref.eu ? ['boards-api.eu', 'boards-api'] : ['boards-api', 'boards-api.eu']) {
      const data = await json(`https://${host}.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${ref.job}?questions=true`)
      if (!data || !Array.isArray(data.questions)) continue
      const extra = [data.location_questions, data.compliance].flatMap((list) => (Array.isArray(list) ? (list as Json[]) : []))
      const questions = [...(data.questions as Json[]), ...extra.flatMap((c) => (Array.isArray(c.questions) ? (c.questions as Json[]) : [c]))]
        .map(question)
        .filter((q): q is FormQuestion => !!q)
      return { ats: 'Greenhouse', url: url.toString(), questions }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Any other form: open it like a browser and read its fields          */
/* ------------------------------------------------------------------ */

/** Buttons and links that lead from a posting to its form ("Apply now", "Online application", "Jetzt bewerben", "Postuler"…). */
const APPLY = /\b(?:apply|application|bewerb\w*|postuler|candidat\w*|i'?m\s+interested)\b/i
/** The button past a form's welcome step; never one that sends the application. */
const NEXT = /^\s*(?:next|continue|weiter|fortfahren|get started|los geht'?s|suivant|commencer)\b/i
const NOT_NEXT = /submit|absenden|abschicken|senden|send|einreichen|envoyer|later|später/i
/** "Step 1 of 5", "Schritt 1 von 5" on a multi-step form. */
const STEPS = /(?:step|schritt|étape)\s*\d+\s*(?:of|von|sur|\/)\s*\d+/i

/** Look-alikes that do not open the form. */
const NOT_APPLY = /share|teilen|mail|merken|save|speichern|print|drucken|login|log in|sign in|anmelden|status|withdraw|zurück|back|similar|ähnlich|tips|tipps|faq/i

interface RawField {
  question: string
  required: boolean
  type: string
  options?: string[]
}

/**
 * Runs in the page (plain JavaScript: the worker has no DOM types): every visible field with its label, type,
 * required flag and options, as { fields, password }.
 */
const EXTRACT_FIELDS = `(() => {
  // Required markers: "*" at the end, or Lever's "✱" anywhere.
  const clean = (s) => (s || '').replace(/✱/g, ' ').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, '').trim()
  const starred = (s) => /\\*\\s*$/.test((s || '').trim()) || (s || '').includes('✱')
  // The text a reader sees (innerText skips hidden helper text such as upload status messages).
  const text = (n) => (n ? n.innerText || n.textContent || '' : '').split(/\\n/).map((t) => t.trim()).filter(Boolean)[0] || ''
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') || el.type === 'file'
  }
  const labelOf = (el) => {
    const id = el.getAttribute('id')
    if (id) {
      const l = document.querySelector('label[for="' + CSS.escape(id) + '"]')
      if (text(l)) return text(l)
    }
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\\s+/).map((x) => text(document.getElementById(x))).join(' ')
      if (t.trim()) return t
    }
    const wrap = el.closest('label')
    if (text(wrap)) return text(wrap)
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')
    let box = el.parentElement
    for (let i = 0; box && i < 4; i++, box = box.parentElement) {
      const l = box.querySelector('label, legend, [class*="label" i], h3, h4')
      if (l && !l.contains(el) && text(l)) return text(l)
    }
    return el.getAttribute('placeholder') || el.getAttribute('name') || ''
  }
  // Page furniture, not the application form: cookie banners, job search and filters, job alerts, header and footer.
  const NOISE = /cookie|consent|onetrust|usercentrics|didomi|borlabs|\\bcmp\\b|search|filter|job-?alert|newsletter/i
  const furniture = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (/^(HEADER|FOOTER|NAV)$/.test(n.tagName)) return true
      const id = n.id + ' ' + (typeof n.className === 'string' ? n.className : '') + ' ' + (n.getAttribute('role') || '') + ' ' + (n.getAttribute('action') || '')
      if (NOISE.test(id)) return true
      // A cookie banner without telling class names: a dialog or fixed layer that talks about cookies.
      const layer = n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true' || getComputedStyle(n).position === 'fixed'
      if (layer && /cookie/i.test(n.textContent || '')) return true
    }
    return false
  }
  const fields = []
  const groups = new Map()
  let password = false
  // Native fields, and the custom widgets of modern forms (role="checkbox" etc.) that wrap no native field.
  const NATIVE = 'input, select, textarea'
  const ROLES = { checkbox: 'checkbox', radio: 'radio', combobox: 'select', listbox: 'select', textbox: 'text' }
  for (const el of document.querySelectorAll(NATIVE + ', [role="checkbox"], [role="radio"], [role="combobox"], [role="listbox"], [role="textbox"]')) {
    const tag = el.tagName.toLowerCase()
    const native = el.matches(NATIVE)
    if (!native && el.querySelector(NATIVE)) continue
    const type = !native ? ROLES[el.getAttribute('role')] : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.type || 'text').toLowerCase()
    if (native && el.closest('[role="checkbox"], [role="radio"], [role="combobox"], [role="listbox"]') && !visible(el)) continue
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue
    if (type === 'password') password = true
    if (!visible(el) && type !== 'radio' && type !== 'checkbox') continue
    if (furniture(el)) continue
    const required = el.required || el.getAttribute('aria-required') === 'true'
    if (type === 'radio' || type === 'checkbox') {
      const box = el.closest('fieldset, [role="radiogroup"], [role="group"]')
      const key = type + ':' + (el.name || (box && box.textContent.slice(0, 40)) || labelOf(el))
      const option = clean(labelOf(el))
      let group = groups.get(key)
      if (!group) {
        const legendEl = box && box.querySelector('legend')
        const legend = text(legendEl) || (box && box.getAttribute('aria-label')) || ''
        group = { question: clean(legend), required: required || starred(legend), type: type === 'radio' ? 'single choice' : 'multiple choice', options: [] }
        groups.set(key, group)
        fields.push(group)
      }
      if (option) group.options.push(option)
      group.required = group.required || required
      continue
    }
    const label = labelOf(el)
    const field = {
      question: clean(label),
      required: required || starred(label),
      type: type === 'select' ? 'single choice' : type === 'textarea' ? 'long text' : type === 'file' ? 'file' : type === 'text' ? 'text' : 'text (' + type + ')',
    }
    if (tag === 'select') {
      const opts = Array.from(el.options).map((o) => clean(o.textContent)).filter((o) => o && !/^(-+|select|please select|bitte (aus)?wählen|choisir)/i.test(o))
      if (opts.length) field.options = opts
      if (el.multiple) field.type = 'multiple choice'
    }
    fields.push(field)
  }
  for (const g of fields) {
    // A lone checkbox ("I agree…") is a question of its own.
    if (g.type === 'multiple choice' && g.options && g.options.length === 1 && !g.question) {
      g.question = g.options[0]
      g.type = 'checkbox'
      delete g.options
    }
  }
  return { fields: fields.filter((f) => f.question || (f.options && f.options.length)), password }
})()`

/**
 * Runs in the page: clicks the best visible Apply button or link (short label, a link to an apply page first);
 * returns the URL instead when the link opens a new tab.
 */
const clickApply = (yes: string, no: string) => `(() => {
  const yes = new RegExp(${JSON.stringify(yes)}, 'i')
  const no = new RegExp(${JSON.stringify(no)}, 'i')
  const candidates = []
  for (const el of document.querySelectorAll('a, button, [role="button"], input[type="submit"]')) {
    const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()
    const href = el.getAttribute('href') || ''
    if (!text || text.length > 40 || !yes.test(text) || no.test(text) || href.startsWith('mailto:')) continue
    if (el.getBoundingClientRect().width === 0) continue
    candidates.push({ el, score: (/apply|bewerb|application|candidat/i.test(href) ? 2 : 0) + (el.tagName === 'A' || el.tagName === 'BUTTON' ? 1 : 0) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0] && candidates[0].el
  if (!best) return false
  if (best.href && best.getAttribute('target') === '_blank') return best.href
  best.click()
  return true
})()`

async function renderedForm(browserBinding: Env['BROWSER'], start: URL): Promise<ApplicationForm | null> {
  const browser = await puppeteer.launch(browserBinding as unknown as BrowserWorker)
  try {
    const page = await browser.newPage()
    await guardPage(page)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36')
    await page.goto(start.toString(), { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => undefined)

    const read = async () => {
      const all: RawField[] = []
      let password = false
      for (const frame of page.frames().filter((f) => isReadableFrame(f.url()))) {
        const r = (await frame.evaluate(EXTRACT_FIELDS).catch(() => null)) as { fields: RawField[]; password: boolean } | null
        if (!r) continue
        all.push(...r.fields)
        password ||= r.password
      }
      return { fields: all, password }
    }

    const press = async (yes: RegExp, no: RegExp) => {
      for (const frame of page.frames().filter((f) => isReadableFrame(f.url()))) {
        const clicked = (await frame.evaluate(clickApply(yes.source, no.source)).catch(() => false)) as string | boolean
        if (clicked) return clicked
      }
      return false
    }

    let found = await read()
    let followed = false
    // A posting page: follow its Apply button to the form, past a welcome step if the form starts with one.
    for (let step = 0; step < 4 && found.fields.length < 3; step++) {
      const clicked = (await press(APPLY, NOT_APPLY)) || (await press(NEXT, NOT_NEXT))
      if (!clicked) break
      followed = true
      if (typeof clicked === 'string') {
        if (!isPublicUrl(clicked)) break
        await page.goto(clicked, { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => undefined)
      }
      else
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12_000 }).catch(() => undefined),
          new Promise((r) => setTimeout(r, 4000)),
        ])
      found = await read()
      // Slow ATS pages (SuccessFactors, Workday) draw their form a few seconds after the navigation ends:
      // read again until the number of fields stops changing.
      for (let wait = 0, before = -1; wait < 4 && (found.fields.length < 3 || found.fields.length !== before); wait++) {
        before = found.fields.length
        await new Promise((r) => setTimeout(r, 2500))
        found = await read()
      }
    }

    const finalUrl = page.url()
    if (!isPublicUrl(finalUrl)) return null
    const steps = (await page.evaluate(`(document.body.innerText.match(${STEPS}) || [''])[0]`).catch(() => '')) as string
    // Only a real form counts: a page with a stray field or two (language switch, job alert) and no Apply button
    // is a posting whose form was not reached. A multi-step form is reported even from its welcome page.
    found.fields = found.fields.filter((f) => f.question)
    if (!steps && !(found.fields.length >= 3 || (followed && found.fields.length > 0))) return null
    const notes = [
      ...(found.password ? ['This form asks for a password: it needs an account on the company site. The fields listed are what shows before signing in.'] : []),
      ...(steps ? [`Multi-step form ("${steps}"): only the first step's fields are listed; open it in the browser for the later steps.`] : []),
    ]
    return {
      ats: new URL(finalUrl).hostname.replace(/^www\./, ''),
      url: finalUrl,
      questions: found.fields.map((f) => ({
        question: f.question || '(unlabelled field)',
        required: f.required,
        type: f.type,
        ...(f.options?.length ? { options: f.options.slice(0, 40), ...(f.options.length > 40 ? { options_total: f.options.length } : {}) } : {}),
      })),
      ...(notes.length ? { note: notes.join(' ') } : {}),
    }
  } finally {
    await browser.close()
  }
}
