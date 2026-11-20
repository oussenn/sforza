import { describe, expect, it } from 'vitest'
import { applyCuts, applyMoves, cutOrder, decodeCuts, encodeCuts, moveOptions } from '../shared/shrink'
import { TEMPLATE_MAP } from '../shared/templates'
import type { ResumeContent, ResumeStyle, Section, SectionItem } from '../shared/types'
import { shrinkToPage } from '../src/resume/fit'
import type { LayoutReport } from '../src/resume/layout'

const exp = (id: string, bullets: string[]) => ({ id, position: 'Engineer', company: 'Acme', url: '', location: '', start: '2024', end: '2025', current: false, description: bullets.map((b) => `- ${b}`).join('\n') })
const proj = (id: string, name: string, bullets: string[]) => ({ id, name, subtitle: '', url: '', start: '', end: '', description: bullets.map((b) => `- ${b}`).join('\n') })
const skill = (id: string, name: string, details: string) => ({ id, name, details, level: 0 })
const award = (id: string, title: string) => ({ id, title, subtitle: '', location: '', start: '', end: '', url: '', description: '' })

function cv(): ResumeContent {
  const sections = [
    { id: 's_sum', type: 'summary', title: 'Profile', visible: true, placement: 'main', text: 'Data engineer.' },
    {
      id: 's_exp',
      type: 'experience',
      title: 'Experience',
      visible: true,
      placement: 'main',
      items: [exp('e1', ['Built SQL pipelines in Python', 'Organised the office party', 'Wrote dbt models for reporting', 'Fed the office plants'])],
    },
    {
      id: 's_proj',
      type: 'projects',
      title: 'Projects',
      visible: true,
      placement: 'main',
      items: [proj('p1', 'Pipeline', ['Airflow DAGs loading SQL data', 'Python tests']), proj('p2', 'Game', ['A chess engine in C', 'Fun weekends'])],
    },
    { id: 's_awards', type: 'custom', title: 'Awards', visible: true, placement: 'main', items: [award('a1', 'Chess club winner')] },
    {
      id: 's_skills',
      type: 'skills',
      title: 'Skills',
      visible: true,
      placement: 'side',
      items: [skill('k1', 'Data', 'SQL, Python, dbt'), skill('k2', 'Cloud', 'Airflow'), skill('k3', 'Office', 'Word'), skill('k4', 'Music', 'Guitar')],
    },
    { id: 's_lang', type: 'languages', title: 'Languages', visible: true, placement: 'side', items: [{ id: 'l1', name: 'English', level: 'C1', rating: 0 }] },
  ] as Section[]
  return { personal: { name: 'A', headline: '', contacts: [] } as unknown as ResumeContent['personal'], sections }
}

const JOB = 'Working student data engineering: SQL, Python, dbt and Airflow pipelines for reporting.'

describe('what the page fit may cut from a tailored CV', () => {
  it('cuts what the posting never mentions first, never a role, the languages or a role’s best bullet', () => {
    const order = cutOrder(cv(), JOB)
    const ids = order.map((c) => (c.line === undefined ? c.item : `${c.item}.${c.line}`))
    // Irrelevant: the award, the extra role bullets about the office, the chess project, music and office skills.
    const firstIrrelevant = ids.slice(0, 5)
    expect(firstIrrelevant).toContain('a1')
    expect(firstIrrelevant).toContain('e1.3')
    expect(firstIrrelevant).toContain('e1.1')
    expect(ids).toContain('p2')
    expect(ids).not.toContain('p1') // the most relevant project stays whole
    expect(ids).not.toContain('e1.0') // the role's most relevant bullet stays
    expect(ids).not.toContain('e1') // a role is never hidden
    expect(ids.some((i) => i.startsWith('l1') || i === 's_sum')).toBe(false)
    // Skills: only past the three most relevant groups.
    expect(ids.filter((i) => i.startsWith('k'))).toEqual(['k4'])
    // Something relevant comes only after everything irrelevant.
    expect(ids.indexOf('e1.2')).toBeGreaterThan(ids.indexOf('e1.3'))
  })

  it('hides whole items and removes single bullet lines', () => {
    const out = applyCuts(cv(), [{ item: 'a1' }, { item: 'e1', line: 3 }, { item: 'e1', line: 1 }])
    const items = (id: string) => (out.sections.find((s) => s.id === id) as { items: SectionItem[] }).items
    expect(items('s_awards')[0].hidden).toBe(true)
    expect((items('s_exp')[0] as { description: string }).description).toBe('- Built SQL pipelines in Python\n- Wrote dbt models for reporting')
    expect(decodeCuts(encodeCuts([{ item: 'a1' }, { item: 'e1', line: 3 }]))).toEqual([{ item: 'a1' }, { item: 'e1', line: 3 }])
  })

  it('offers short main-column sections for a side column with room, the last one first', () => {
    expect(moveOptions(cv(), 'side').map((m) => m.section)).toEqual(['s_awards'])
    expect(moveOptions(cv(), 'main').map((m) => m.section)).toEqual(['s_lang', 's_skills'])
    // A moved section goes to the end of its new column.
    const moved = applyMoves(cv(), [{ section: 's_awards', placement: 'side' }])
    expect(moved.sections.map((s) => s.id)).toEqual(['s_sum', 's_exp', 's_proj', 's_skills', 's_lang', 's_awards'])
    expect(moved.sections.find((s) => s.id === 's_awards')?.placement).toBe('side')
  })
})

// A page model: every visible line of a column is 6 mm at 10 pt and 1.2 line height; two columns side by side.
const PAGE = 297
const base: ResumeStyle = { ...TEMPLATE_MAP.signature.style, fontSize: 10, lineHeight: 1.2, columnRatio: 50 }
const linesIn = (c: ResumeContent, col: 'main' | 'side') =>
  c.sections
    .filter((s) => s.visible && (col === 'side' ? s.placement === 'side' : s.placement !== 'side'))
    .reduce((n, s) => n + 2 + (s.type === 'summary' ? 2 : (s.items as SectionItem[]).filter((i) => !i.hidden).reduce((m, i) => m + 1 + ((i as { description?: string }).description?.split('\n').filter(Boolean).length ?? 0), 0)), 0)

function model(lineMm: number) {
  return async (st: ResumeStyle, c: ResumeContent): Promise<LayoutReport> => {
    const h = (col: 'main' | 'side') => linesIn(c, col) * lineMm * (st.fontSize / 10) * (st.lineHeight / 1.2) + 2 * st.marginY + st.sectionGap
    const main = h('main')
    const side = h('side')
    const height = Math.max(main, side)
    const pages = Math.max(1, Math.ceil(height / PAGE))
    const gaps: LayoutReport['gaps'] = []
    const end = pages === 1 ? height : PAGE
    if (pages === 1 && PAGE - height >= 12) gaps.push({ page: 1, column: 'page', mm: Math.round(PAGE - height), before: '' })
    else for (const [column, v] of [['main', main], ['side', side]] as const) if (end - Math.min(v, end) >= 25) gaps.push({ page: 1, column, mm: Math.round(end - v), before: '' })
    return { pages, lastPageFill: Math.round(((height - (pages - 1) * PAGE) / PAGE) * 100), split: [], gaps, lonely: [] }
  }
}

const mixed = { columns: true, ratioIsSide: false, maxLineHeight: 1.25 }

describe('shrinking a CV onto one page', () => {
  it('moves a section into the side column that ends early before cutting anything', async () => {
    // 22 main lines and 9 side lines: even at the tightest spacing the main column runs over while the side one is half empty.
    const r = await shrinkToPage({ ...base, columnRatio: 70 }, cv(), mixed, model(17.5), cutOrder(cv(), JOB))
    expect(r.status).not.toBe('too_long')
    expect(r.moves).toEqual([{ section: 's_awards', placement: 'side' }])
    expect(r.cuts).toEqual([])
  })

  it('cuts the fewest least relevant pieces when moving is not enough', async () => {
    const r = await shrinkToPage({ ...base, columnRatio: 70 }, cv(), mixed, model(19), cutOrder(cv(), JOB))
    expect(r.status).not.toBe('too_long')
    expect(r.layout.pages).toBe(1)
    expect(r.cuts.length).toBeGreaterThan(0)
    // A prefix of the order without the side column's items (it has room: cutting there frees nothing), never the role's best bullet.
    const side = new Set(['k1', 'k2', 'k3', 'k4', 'l1'])
    const order = cutOrder(cv(), JOB).filter((c) => !side.has(c.item))
    expect(r.cuts).toEqual(order.slice(0, r.cuts.length))
    expect(r.cuts).not.toContainEqual({ item: 'e1', line: 0 })
  })

  it('changes nothing when the content cannot fit even with every cut, or no cuts are allowed', async () => {
    const r = await shrinkToPage(base, cv(), mixed, model(60), cutOrder(cv(), JOB))
    expect(r.status).toBe('too_long')
    expect(r.cuts).toEqual([])
    expect(r.moves).toEqual([])
    const master = await shrinkToPage({ ...base, columnRatio: 70 }, cv(), mixed, model(19), [])
    expect(master.cuts).toEqual([])
  })

  it('fills a side column that ends early on a page that already fits', async () => {
    const r = await shrinkToPage({ ...base, columnRatio: 70 }, cv(), mixed, model(12), cutOrder(cv(), JOB))
    expect(r.layout.pages).toBe(1)
    expect(r.moves).toEqual([{ section: 's_awards', placement: 'side' }])
    expect(r.cuts).toEqual([])
  })

  it('leaves a CV that already fits alone', async () => {
    const r = await shrinkToPage(base, cv(), mixed, model(5), cutOrder(cv(), JOB))
    expect(r.moves).toEqual([])
    expect(r.cuts).toEqual([])
  })
})
