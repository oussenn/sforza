import { applyCuts, applyMoves, cutOrder } from '@shared/shrink'
import type { Application, Lang, Resume, ResumeContent, ResumeStyle, SectionItem } from '@shared/types'
import { availableLangs, isItemSection, itemHead } from '@shared/utils'
import { AiError } from './ai'
import * as db from './db'
import { checkLayout, checkLetterFit, fitLayout, type FitReport } from './pdf'
import { letterCv } from './service'

/**
 * The one-page rules, shared by the connector's tools and the editor's AI buttons: how a CV and a letter sit on
 * the page (measured on the print page), and the automatic fit that makes a CV fill exactly one page (style first,
 * then a section moved to the column with room, then on a tailored CV the content least relevant to its posting).
 */

type Json = Record<string, unknown>

/** The page fit could not run (no browser session right now): the message is written for the user. */
class PageFitError extends AiError {}

/** What fit_cv_to_page may change, by its edit_cv name. */
const FIT_KEYS = ['fontSize', 'lineHeight', 'sectionGap', 'itemGap', 'marginY', 'columnRatio'] as const
const FIT_NAMES: Record<(typeof FIT_KEYS)[number], string> = {
  fontSize: 'font_size',
  lineHeight: 'line_height',
  sectionGap: 'section_gap',
  itemGap: 'item_gap',
  marginY: 'margin_y',
  columnRatio: 'column_ratio',
}
/** The fit settings of a style, in edit_cv's names. */
const fitStyle = (style: ResumeStyle) => Object.fromEntries(FIT_KEYS.map((key) => [FIT_NAMES[key], style[key]]))

export const LAYOUT_FIX =
  'Layout rule for a tailored CV: exactly one page, completely filled: every section whole, no empty space at the bottom of the page or under a column. Run fit_cv_to_page (the tools that change a CV run it themselves when the layout is not ok): it sets font size, spacing and column width, moves a section into a column that ends early and, when a tailored CV is still too long, hides the content least relevant to the posting; check what it hid. Spacing, font size and column width: never by hand. Still too short after it, or a column that ends early: add a relevant bullet or project, or move a section to the other column. Too long even after it: hide the least relevant bullets, projects or skill groups (edit_cv), keeping everything the posting asks for. A tailored CV is ready only when its layout says "ok": true; only the master CV may have two pages. A section alone in a column with the other half of the page white goes full width (edit_cv sections placement "full"). Use edit_cv for content and placement (it keeps the translations).'

/** The rendered CV's page layout as advice for the agent: whole sections on each page, no gap at a page bottom. */
export async function layoutOf(env: Env, origin: string, resume: Resume, lang: Lang) {
  try {
    const l = await checkLayout(env as Env & db.Store, origin, resume, lang)
    // A tailored CV is one full page; only the master CV (the source of everything) may run longer.
    const onePage = resume.kind !== 'master'
    const problems = [
      ...(onePage && l.pages > 1 ? [`${l.pages} pages: a tailored CV must fit on one page`] : []),
      ...l.split.map((t) => `"${t}" runs over a page break`),
      ...l.gaps.map(
        (g) =>
          `${g.mm} mm empty at the bottom of page ${g.page}${g.column === 'page' ? '' : ` under the ${g.column} column`}${g.before ? `, before "${g.before.slice(0, 50)}"` : ': fill it (relevant bullet or project, or a little more spacing)'}`,
      ),
      ...(l.lonely ?? []).map(
        (s) =>
          `${s.sections.map((t) => `"${t}"`).join(', ')} sits alone in the side column on page ${s.page}, with the other half of the page empty: make it full width (edit_cv sections ${JSON.stringify((s.types.length ? s.types : ['languages']).map((type) => ({ type, placement: 'full' })))}) or shorten the side column`,
      ),
    ]
    return {
      checked: true,
      pages: l.pages,
      fill_percent: l.lastPageFill,
      ok: problems.length === 0,
      problems,
      next: problems.length
        ? onePage
          ? LAYOUT_FIX
          : 'Master CV: fix what is listed (sections whole, no column that ends early) with edit_cv placement, or run fit_cv_to_page; it may keep two pages.'
        : l.pages === 1
          ? 'Good layout: one full page. Nothing to do.'
          : 'Whole sections, no gaps.',
    }
  } catch (err) {
    return { checked: false, error: (err as Error).message, next: 'Layout check unavailable; ask the user to look at the PDF.' }
  }
}

/** A tailored CV's job, for ranking what to hide when the CV runs long. */
const jobText = (r: Resume) => (r.job ? `${r.job.title}\n${r.job.description}` : '')

/** What autoFit changed besides the style, for the agent to review. */
interface ShrinkLog {
  moved: string[]
  hidden: { id: string; item: string }[]
  removed_bullets: { id: string; item: string; bullet: string }[]
  kept_in: Lang[]
}

const itemsOf = (c: ResumeContent) => c.sections.flatMap((s) => (isItemSection(s) ? (s.items as SectionItem[]) : []))
const linesOf = (it: SectionItem | undefined) => ((it as { description?: string } | undefined)?.description ?? '').split('\n')

/** Applies one language's moves and cuts to every language: the same sections and items, and the same bullet line where the translation has as many lines. */
function applyShrink(resume: Resume, lang: Lang, f: FitReport, log: ShrinkLog) {
  const measured = resume.content[lang]!
  const byId = new Map(itemsOf(measured).map((i) => [i.id, i]))
  for (const m of f.moves ?? []) log.moved.push(`"${measured.sections.find((x) => x.id === m.section)?.title ?? m.section}" to the ${m.placement} column`)
  const cuts = f.cuts ?? []
  for (const c of cuts) {
    const it = byId.get(c.item)
    if (!it) continue
    if (c.line === undefined) log.hidden.push({ id: c.item, item: itemHead(it) })
    else log.removed_bullets.push({ id: c.item, item: itemHead(it), bullet: (linesOf(it)[c.line] ?? '').replace(/^\s*[-•*]\s+/, '') })
  }
  for (const [l, content] of Object.entries(resume.content) as [Lang, ResumeContent][]) {
    const there = new Map(itemsOf(content).map((i) => [i.id, i]))
    const same = cuts.filter((c) => c.line === undefined || linesOf(there.get(c.item)).length === linesOf(byId.get(c.item)).length)
    if (same.length < cuts.length) log.kept_in.push(l)
    resume.content[l] = applyCuts(applyMoves(content, f.moves ?? []), same)
  }
}

/**
 * fit_cv_to_page, also run by the tools that change a CV: in every language the fullest style that keeps one page.
 * When spacing alone cannot, the print page may move a section into the column that ends early and, on a tailored
 * CV, hide the content least relevant to its posting (shared/shrink.ts) until it fits. Saves the CV.
 */
export async function autoFit(env: Env, origin: string, resume: Resume): Promise<Json> {
  const langs = availableLangs(resume)
  const canCut = resume.kind !== 'master' && !!resume.job
  const fits: [Lang, FitReport][] = []
  const log: ShrinkLog = { moved: [], hidden: [], removed_bullets: [], kept_in: [] }
  try {
    // One language after the other: each fit is a browser session and reads the CV as last saved.
    for (const l of langs) {
      const f = await fitLayout(env as Env & db.Store, origin, resume, l, { cuts: canCut ? cutOrder(resume.content[l]!, jobText(resume)) : [] })
      if (f.status !== 'too_long' && (f.moves?.length || f.cuts?.length)) {
        applyShrink(resume, l, f, log)
        resume.updatedAt = new Date().toISOString()
        await db.saveResume(env, resume)
      }
      fits.push([l, f])
    }
  } catch (err) {
    throw new PageFitError(`The page fit is unavailable right now (${(err as Error).message}); try again in a minute.`)
  }
  const cut = log.hidden.length + log.removed_bullets.length > 0
  const shrunk = cut || log.moved.length > 0
  const changes: Json = {
    ...(log.moved.length ? { moved: log.moved } : {}),
    ...(log.hidden.length ? { hidden: log.hidden } : {}),
    ...(log.removed_bullets.length ? { removed_bullets: log.removed_bullets } : {}),
  }
  const done = [log.moved.length && 'moved a section to the column with room', cut && 'took out the content least relevant to the posting (hidden, removed_bullets)'].filter(Boolean)
  const review = shrunk
    ? ` To keep one page the server ${done.join(' and ')}.${cut ? ' Check that nothing the posting asks for is gone; to bring an item back use edit_cv items [{ id, hidden: false }] (a bullet: edit_cv items [{ id, fields: { description } }] with the bullet back in) and hide something less relevant instead.' : ''}${log.kept_in.length ? ` The ${log.kept_in.join(', ')} version has a different number of lines in a shortened item and keeps that bullet: check it.` : ''}`
    : ''
  const long = fits.filter(([, f]) => f.status === 'too_long')
  if (long.length) {
    return {
      changed: shrunk,
      ...changes,
      ok: false,
      too_long: Object.fromEntries(long.map(([l, f]) => [l, `${f.layout.lastPageFill}% of a second page left over at 9 pt with the tightest spacing${canCut ? ', even after hiding what the server may hide' : ''}`])),
      next:
        (resume.kind === 'master'
          ? 'The master CV holds more than one page, which is fine for the source of every tailored CV. A CV to send must fit one page: tailor one for the job (save_tailored_cv), do not cut the master for it.'
          : 'Too much content for one page. Hide the least relevant bullets, projects or skill groups with edit_cv (about that much), keep everything the posting asks for, then run fit_cv_to_page again.') + review,
    }
  }
  // One style serves every language: the tightest of their fits keeps the longest language on one page too.
  const density = (st: ResumeStyle) => st.fontSize * 10 + st.lineHeight
  const [longest, tightest] = fits.map(([l, f]) => [l, f.style] as const).reduce((a, b) => (density(b[1]) < density(a[1]) ? b : a))
  const before = fitStyle(resume.style)
  for (const key of FIT_KEYS) resume.style[key] = tightest[key]
  resume.updatedAt = new Date().toISOString()
  await db.saveResume(env, resume)
  const layout: Record<string, Awaited<ReturnType<typeof layoutOf>>> = {}
  for (const l of langs) layout[l] = await layoutOf(env, origin, resume, l)
  const isOk = (l: Lang) => layout[l]?.ok === true
  const ok = langs.every(isOk)
  const short = fits.some(([, f]) => f.status === 'too_short')
  // The longest language sets the style; a shorter translation keeps some room that only its own text can fill.
  const shorter = isOk(longest) ? langs.filter((l) => !isOk(l)) : []
  return {
    changed: true,
    before,
    after: fitStyle(resume.style),
    ...changes,
    layout,
    ok,
    next:
      (ok
        ? 'One full page in every language. Nothing to do.'
        : short
          ? 'The page stays short even at the roomiest setting: add a relevant bullet or project with edit_cv, then run fit_cv_to_page again.'
          : shorter.length
            ? `One style serves every language and ${longest} is the longest, so ${shorter.join(' and ')} keeps room at the bottom. Fill it in that language only: edit_cv with lang "${shorter[0]}" and a slightly fuller bullet or one more fact the knowledge base states, then run fit_cv_to_page again.`
            : 'Fix what the layout lists with edit_cv (a column that ends early: move a section to the other column or make it full width; a section over a page break: shorten it), then run fit_cv_to_page again.') + review,
  }
}

export const LETTER_FIX =
  'Layout rule for a motivation letter: one page. Shorten it (drop a sentence or tighten a paragraph, staying within 220–320 words; a long address block or enclosures list costs lines too) and save it again with save_motivation_letter. A letter is ready only when its layout says "ok": true.'

/** Whether the rendered letter fits on one page. */
export async function letterFitOf(env: Env, origin: string, app: Application, lang: Lang) {
  try {
    const l = await checkLetterFit(env as Env & db.Store, origin, app, await letterCv(env, app), lang)
    // About 5 mm a line and 12 words a line at letter sizes, plus a few words so the cut is enough at once.
    const words = Math.ceil(Math.max(1, l.overMm) / 5) * 12 + 5
    const problems = l.pages > 1 ? [`${l.pages} pages: the letter runs about ${Math.max(1, l.overMm)} mm past one page; cut about ${words} words`] : []
    return { checked: true, pages: l.pages, ok: !problems.length, problems, next: problems.length ? LETTER_FIX : 'Good layout: one page. Nothing to do.' }
  } catch (err) {
    return { checked: false, error: (err as Error).message, next: 'Layout check unavailable; ask the user to look at the PDF.' }
  }
}

/** One line on what the automatic fit did, for a CV's notes and the editor's progress. */
export function pageFitNote(fit: Json): string {
  if (fit.error) return `Page fit unavailable (${String(fit.error)}): check the PDF, then run the fit again.`
  const list = (v: unknown, key: string) => (Array.isArray(v) ? (v as Record<string, string>[]).map((x) => (key ? x[key] : String(x))).filter(Boolean) : [])
  const moved = list(fit.moved, '')
  const hidden = list(fit.hidden, 'item')
  const bullets = list(fit.removed_bullets, 'bullet')
  const changes = [
    moved.length ? `moved ${moved.join(', ')}` : '',
    hidden.length ? `hid ${hidden.join('; ')}` : '',
    bullets.length ? `took out ${bullets.length} bullet${bullets.length > 1 ? 's' : ''} (${bullets.map((b) => `"${b.slice(0, 60)}"`).join(', ')})` : '',
  ].filter(Boolean)
  const done = changes.length ? ` To keep one page it ${changes.join(', ')}; bring back anything the posting asks for and hide something else.` : ''
  if (fit.too_long) return `Page fit: still longer than one page.${done} Hide the least relevant bullets or projects, then fit again.`
  return fit.ok ? `Page fit: one full page.${done}` : `Page fit: one page, but the layout check lists something to fix (open the layout check).${done}`
}

