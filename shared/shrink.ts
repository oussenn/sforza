import type { Placement, ResumeContent, SectionItem } from './types'

/**
 * What the page fit may change on a CV that runs over one page even at the tightest readable spacing
 * (src/resume/fit.ts shrinkToPage). On two columns it first moves a section into the column that ends early;
 * on a tailored CV it then hides the content least relevant to the posting, a little at a time, until the page
 * fits: the order comes from `cutOrder`. Experience, education, languages and the summary are never hidden, and
 * every role keeps its most relevant bullet.
 */

/** One cut: a whole item (hidden, so it can be shown again), or one bullet line of its description (removed). */
export interface Cut {
  item: string
  /** index of the bullet among the description's lines */
  line?: number
}

/** A section moved to the other column. */
export interface Move {
  section: string
  placement: Placement
}

const BULLET = /^\s*[-•*]\s+/

/** Indexes of the description's bullet lines. */
const bulletLines = (description: string) => description.split('\n').flatMap((l, i) => (BULLET.test(l) ? [i] : []))

// Words that say nothing about a job, in English and German.
const STOP = new Set(
  (
    'a an and are as at be been but by can do for from has have in into is it its more most not of on or our over so such than that the their them ' +
    'there these they this to up us was we were what when where which while who will with within without you your all also any both each other ' +
    'some very well per via etc e g i e my me am im ich wir sie er es du der die das den dem des ein eine einer einem einen und oder mit von zu zur zum ' +
    'auf aus bei für fur nach über uber unter vor bis als wie wenn auch nicht noch nur sehr sowie sind ist bist seid war waren wird werden hat haben ' +
    'kann können konnen sich ihr ihre ihren unsere unser dein deine im am an ab um wo ob m w d f mwd wmd gn'
  ).split(' '),
)

/** The words of a text, for comparing it with a posting: lower case, without stop words, long words cut to a stem. */
export function terms(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}+#]+/u)) {
    const w = raw.replace(/^\++/, '')
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w.length > 6 ? w.slice(0, 6) : w)
  }
  return out
}

const itemText = (item: SectionItem) =>
  Object.entries(item)
    .filter(([k, v]) => typeof v === 'string' && k !== 'id' && k !== 'url')
    .map(([, v]) => v)
    .join(' ')

/** How many of the posting's words a text uses. */
const relevance = (text: string, job: Set<string>) => [...terms(text)].filter((w) => job.has(w)).length

/** What goes first among equally relevant pieces: lower first. */
const RANK = { manySkills: 0, projectBullet: 1, roleBullet: 2, shortItem: 3, skillGroup: 4, project: 5, secondBullet: 6 }

/**
 * The order in which to hide content when a tailored CV is too long: whatever shares no word with the posting
 * first, then the least relevant. Within that, by kind (RANK): skill groups past the six most relevant, project bullets
 * past the two most relevant, role bullets past the two most relevant, certificates and custom items (awards,
 * activities), skill groups past the three most relevant, whole projects but the most relevant, and last the second
 * bullet of a role or project.
 */
export function cutOrder(content: ResumeContent, jobText: string): Cut[] {
  const job = terms(jobText)
  const found: (Cut & { score: number; rank: number; order: number })[] = []
  let order = 0
  const add = (cut: Cut, text: string, rank: number) => found.push({ ...cut, score: relevance(text, job), rank, order: order++ })
  for (const s of content.sections) {
    if (!s.visible || s.type === 'summary') continue
    const items = (s.items as SectionItem[]).filter((i) => !i.hidden)
    if (s.type === 'experience' || s.type === 'projects') {
      if (s.type === 'projects' && items.length > 1) {
        const best = items.reduce((a, b) => (relevance(itemText(b), job) > relevance(itemText(a), job) ? b : a))
        for (const it of items) if (it !== best) add({ item: it.id }, itemText(it), RANK.project)
      }
      for (const it of items as { id: string; description: string }[]) {
        const lines = it.description.split('\n')
        const bullets = bulletLines(it.description)
          .map((i) => ({ i, score: relevance(lines[i], job) }))
          .sort((a, b) => b.score - a.score || a.i - b.i)
        bullets.forEach((b, k) => {
          if (k >= 2) add({ item: it.id, line: b.i }, lines[b.i], s.type === 'projects' ? RANK.projectBullet : RANK.roleBullet)
          else if (k === 1) add({ item: it.id, line: b.i }, lines[b.i], RANK.secondBullet)
        })
      }
    } else if (s.type === 'skills') {
      const ranked = [...items].sort((a, b) => relevance(itemText(b), job) - relevance(itemText(a), job))
      ranked.slice(3).forEach((it, k) => add({ item: it.id }, itemText(it), k + 3 >= 6 ? RANK.manySkills : RANK.skillGroup))
    } else if (s.type === 'certifications' || s.type === 'custom') {
      for (const it of items) add({ item: it.id }, itemText(it), RANK.shortItem)
    }
  }
  return found
    .sort((a, b) => Number(a.score > 0) - Number(b.score > 0) || a.rank - b.rank || a.score - b.score || b.order - a.order)
    .map(({ item, line }) => (line === undefined ? { item } : { item, line }))
}

/** The content with these cuts: items hidden, bullet lines removed. */
export function applyCuts(content: ResumeContent, cuts: Cut[]): ResumeContent {
  const out = structuredClone(content)
  for (const s of out.sections) {
    if (s.type === 'summary') continue
    for (const it of s.items as SectionItem[]) {
      const mine = cuts.filter((c) => c.item === it.id)
      if (!mine.length) continue
      if (mine.some((c) => c.line === undefined)) it.hidden = true
      const lines = new Set(mine.flatMap((c) => (c.line === undefined ? [] : [c.line])))
      const d = it as { description?: string }
      if (lines.size && typeof d.description === 'string')
        d.description = d.description
          .split('\n')
          .filter((_, i) => !lines.has(i))
          .join('\n')
    }
  }
  return out
}

/** The content with these sections moved, each to the end of its new column. */
export function applyMoves(content: ResumeContent, moves: Move[]): ResumeContent {
  const out = structuredClone(content)
  const column = (p: Placement) => (p === 'side' ? 'side' : 'main')
  for (const m of moves) {
    const at = out.sections.findIndex((x) => x.id === m.section)
    if (at < 0) continue
    const [s] = out.sections.splice(at, 1)
    s.placement = m.placement
    const last = out.sections.reduce((found, x, i) => (column(x.placement) === column(m.placement) ? i : found), -1)
    out.sections.splice(last >= 0 ? last + 1 : at, 0, s)
  }
  return out
}

/** Into the narrow side column go only short sections; anything but the summary and experience can go to the main one. */
const SIDE_TYPES = ['languages', 'skills', 'certifications', 'education', 'custom']

/** Sections that could move into the column that ends early, the last one of the other column first. */
export function moveOptions(content: ResumeContent, into: 'main' | 'side'): Move[] {
  return content.sections
    .filter((s) => s.visible && s.type !== 'summary' && s.type !== 'experience' && (into === 'main' ? s.placement === 'side' : s.placement !== 'side' && SIDE_TYPES.includes(s.type)))
    .filter((s) => s.type !== 'summary' && (s.items as SectionItem[]).some((i) => !i.hidden))
    .reverse()
    .map((s) => ({ section: s.id, placement: into }))
}

/** Cuts as a URL parameter (item ids, a bullet as id.line) and back. */
export const encodeCuts = (cuts: Cut[]) => cuts.map((c) => (c.line === undefined ? c.item : `${c.item}.${c.line}`)).join(',')
export const decodeCuts = (s: string): Cut[] =>
  s
    .split(',')
    .filter(Boolean)
    .map((p) => {
      const m = /^(.+)\.(\d+)$/.exec(p)
      return m ? { item: m[1], line: Number(m[2]) } : { item: p }
    })
