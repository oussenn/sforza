import { describe, expect, it } from 'vitest'
import type { JobAnalysis, RequirementResult, ResumeContent, SkillsSection } from '@shared/types'
import { masterContent, seedLibrary } from '@shared/seed'
import { computeScore, quoteFound } from '../worker/match'
import { finishTailoring, tailoringMaterial, type TailorOutput } from '../worker/tailor'

const job = { title: 'Data Analyst', company: 'Acme Logistics', url: '', description: 'SQL, Python and Power BI reporting.' }

/** What the model answered, with everything it was not asked for left empty. */
const answer = (part: Partial<TailorOutput>): TailorOutput => ({
  resumeName: '',
  headline: '',
  summary: '',
  experience: [],
  projects: [],
  education: [],
  skills: [],
  certifications: [],
  notes: '',
  ...part,
})

const summaryOf = (c: ResumeContent) => c.sections.find((s) => s.type === 'summary') as { text: string }
const skillsOf = (c: ResumeContent) => (c.sections.find((s) => s.type === 'skills') as { items: { details: string }[] }).items.map((i) => i.details).join(' ')
const experienceOf = (c: ResumeContent) => (c.sections.find((s) => s.type === 'experience') as { items: { id: string; description: string }[] }).items

describe('tailoring never adds facts the material does not state', () => {
  it('keeps the original headline and summary when the AI invents a tool or a number', () => {
    const out = finishTailoring(
      masterContent,
      seedLibrary,
      answer({ headline: 'Senior Kubernetes Architect', summary: 'Cut reporting time by 73% for 40 clients with Terraform.' }),
      job,
      true,
    )
    expect(out.content.personal.headline).toBe(job.title)
    expect(summaryOf(out.content).text).toBe(summaryOf(masterContent).text)
    expect(out.notes).toMatch(/Kubernetes/)
    expect(out.notes).toMatch(/73/)
  })

  it('writes the skill groups into the main skills section and leaves a courses section as it is', () => {
    const base = structuredClone(masterContent)
    const skills = base.sections.find((s) => s.type === 'skills') as SkillsSection
    const courses: SkillsSection = { ...skills, id: 'sec_courses', title: 'DataCamp Courses', items: [{ id: 'course_1', name: 'SQL', details: 'Intermediate SQL', level: 0 }] }
    base.sections.splice(base.sections.indexOf(skills), 0, courses)
    const out = finishTailoring(base, seedLibrary, answer({ skills: [{ name: 'Data', items: ['Python', 'Power BI'] }] }), job, true)
    const [first, second] = out.content.sections.filter((s) => s.type === 'skills') as SkillsSection[]
    expect(first!.items).toEqual(courses.items)
    expect(second!.items.map((i) => i.details).join(' ')).toContain('Python')
  })

  it("keeps the CV's own wording of a project the library also holds under the same id", () => {
    const project = (masterContent.sections.find((s) => s.type === 'projects') as { items: { id: string; description: string }[] }).items[0]!
    const library = { ...seedLibrary, projects: [...seedLibrary.projects, { ...project, description: 'A longer library draft of the same project.' }] }
    const out = finishTailoring(masterContent, library, answer({ projects: [{ id: project.id, description: '' }] }), job, true)
    const picked = (out.content.sections.find((s) => s.type === 'projects') as { items: { id: string; description: string }[] }).items
    expect(picked.map((p) => p.description)).toEqual([project.description])
  })

  it('drops invented skills and keeps listed ones', () => {
    const out = finishTailoring(masterContent, seedLibrary, answer({ skills: [{ name: 'Data', items: ['Python', 'Power BI', 'Haskell'] }] }), job, true)
    expect(skillsOf(out.content)).toContain('Python')
    expect(skillsOf(out.content)).not.toContain('Haskell')
    expect(out.notes).toContain('Removed skill "Haskell"')
  })

  it('ignores bullets, projects and certificates that do not exist in the material', () => {
    const role = experienceOf(masterContent)[0]
    const out = finishTailoring(
      masterContent,
      seedLibrary,
      answer({
        experience: [{ id: role.id, bullets: [{ ref: 'made-up', text: 'Led a team of 12 engineers.' }] }],
        projects: [{ id: 'prj_made_up', description: 'A project that never happened.' }],
        certifications: ['cert_made_up'],
      }),
      job,
      false,
    )
    expect(experienceOf(out.content)[0].description).toBe(role.description)
    expect(JSON.stringify(out.content)).not.toContain('never happened')
    expect(JSON.stringify(out.content)).not.toContain('team of 12')
  })

  it('in rewrite mode, keeps the original line when the rewrite adds a metric', () => {
    const material = tailoringMaterial(masterContent, seedLibrary) as { experience: { id: string; bullets: { ref: string; text: string }[] }[] }
    const role = material.experience.find((e) => e.bullets.length)!
    const line = role.bullets[0]
    const out = finishTailoring(
      masterContent,
      seedLibrary,
      answer({ experience: [{ id: role.id, bullets: [{ ref: line.ref, text: `${line.text.replace(/\.$/, '')}, saving 95% of the effort.` }] }] }),
      job,
      false,
    )
    const description = experienceOf(out.content).find((e) => e.id === role.id)!.description
    expect(description).toContain(line.text)
    expect(description).not.toContain('95%')
    expect(out.notes).toContain('95')
  })
})

describe('match scoring', () => {
  it('accepts evidence only when the CV says it', () => {
    const cv = 'Built Power BI sales reports for 12 regional managers on a SQL data model, with Python for the data prep.'
    expect(quoteFound('built **Power BI** sales reports for 12 regional managers on a **SQL** data model', cv)).toBe(true)
    expect(quoteFound('Led the migration of 40 servers to Kubernetes', cv)).toBe(false)
    expect(quoteFound('Python', cv)).toBe(true)
    expect(quoteFound('', cv)).toBe(false)
  })

  const analysis = (knockoutCategory: 'languages' | 'seniority'): JobAnalysis =>
    ({
      requirements: [
        { id: 'r1', text: 'SQL', quote: 'SQL', category: 'skills', importance: 'must', knockout: false },
        { id: 'r2', text: 'Python', quote: 'Python', category: 'skills', importance: 'must', knockout: false },
        { id: 'r3', text: 'Fluent German', quote: 'fluent German', category: knockoutCategory, importance: 'must', knockout: true },
      ],
      keywords: [],
    }) as unknown as JobAnalysis
  const verdicts = (r3: RequirementResult['verdict']): RequirementResult[] => [
    { id: 'r1', verdict: 'met', evidence: 'SQL', reason: '' },
    { id: 'r2', verdict: 'met', evidence: 'Python', reason: '' },
    { id: 'r3', verdict: r3, evidence: '', reason: '' },
  ]

  it('caps the score when a hard requirement is missing', () => {
    const missing = computeScore(analysis('languages'), verdicts('missing'), 'SQL Python')
    expect(missing.overall).toBe(35)
    expect(missing.cap?.reason).toContain('Fluent German')
    expect(computeScore(analysis('seniority'), verdicts('missing'), 'SQL Python').overall).toBe(50)
    expect(computeScore(analysis('languages'), verdicts('met'), 'SQL Python')).toMatchObject({ overall: 100, cap: null })
  })

  it('counts a requirement the model skipped as missing', () => {
    expect(computeScore(analysis('languages'), verdicts('met').slice(0, 2), 'SQL Python').overall).toBe(35)
  })
})
