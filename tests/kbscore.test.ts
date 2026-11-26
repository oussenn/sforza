import { describe, expect, it } from 'vitest'
import { knowledgeScore, levelOf, points, scoreColor, skillNames, TARGETS } from '../shared/kbscore'
import type { Library, ResumeContent } from '../shared/types'

const empty: Library = { projects: [], skills: [], experience: [], certifications: [], notes: '' }
const role = (position: string, lines: string[]) => ({ id: position, position, company: 'Acme', url: '', location: '', start: '', end: '', current: false, description: lines.map((l) => `- ${l}`).join('\n') })
const project = (name: string, description: string) => ({ id: name, name, subtitle: '', url: '', start: '', end: '', description })

const cv = (sections: unknown[]): ResumeContent => ({ personal: { name: 'Alex', headline: '', contacts: [] }, sections: sections as ResumeContent['sections'] })
const section = (type: string, items: unknown[]) => ({ id: type, type, title: type, visible: true, placement: 'main', items })

describe('knowledge score', () => {
  it('is 0 for nothing, with every part as a next step, biggest gain first', () => {
    const s = knowledgeScore(null, empty)
    expect(s.score).toBe(0)
    expect(s.level.id).toBe('start')
    expect(s.next.map((n) => n.part).slice(0, 2).sort()).toEqual(['experience', 'projects'])
    expect(Object.values(TARGETS).reduce((a, t) => a + t.weight, 0)).toBe(100)
  })

  it('counts the master CV and the knowledge base together, each role once', () => {
    const content = cv([section('experience', [role('Analyst', ['Built 12 dashboards', 'Cut reporting time by 30 %', 'Trained 5 colleagues'])])])
    const lib = { ...empty, experience: [role('Analyst', ['short']), role('Working student', ['Automated invoices', 'Wrote tests', 'Ran 3 workshops'])] }
    const s = knowledgeScore(content, lib)
    const exp = s.parts.find((p) => p.id === 'experience')!
    expect(exp.have).toBe(2)
    expect(exp.ratio).toBeCloseTo(2 / 3, 5)
    expect(s.parts.find((p) => p.id === 'results')!.have).toBe(4)
  })

  it('reaches 100 when every minimum is met', () => {
    const roles = ['A', 'B', 'C'].map((n) => role(n, [`Shipped ${n} for 200 users`, 'Second point', 'Third point']))
    const projects = Array.from({ length: 6 }, (_, i) => project(`P${i}`, `- Built a tool in Python\n- Saved 4 hours a week`))
    const skills = [{ id: 's', name: 'Tools', details: Array.from({ length: 20 }, (_, i) => `skill${i}`).join(', '), level: 0 }]
    const content = cv([
      section('experience', roles),
      section('projects', projects),
      section('skills', skills),
      section('education', [{ id: 'e', degree: 'M.Sc. Data Science', school: 'TU' }]),
      section('certifications', [{ id: 'c1', name: 'AWS' }, { id: 'c2', name: 'Scrum' }]),
      section('languages', [{ id: 'l1', name: 'English' }, { id: 'l2', name: 'German' }]),
    ])
    const s = knowledgeScore(content, { ...empty, notes: 'word '.repeat(160) })
    expect(s.score).toBe(100)
    expect(s.level.id).toBe('excellent')
    expect(s.next).toEqual([])
  })

  it('reads points, skills and figures sensibly', () => {
    expect(points('- one\n\n* two\n1. three\nfour')).toEqual(['one', 'two', 'three', 'four'])
    expect([...skillNames([{ name: 'Programming', details: 'Python, SQL and R; Power BI' }, { name: 'Excel', details: '' }])]).toEqual(['python', 'sql', 'r', 'power bi', 'excel'])
    const years = knowledgeScore(cv([section('experience', [role('X', ['Joined in 2024', 'Left 01.02.2025', 'Grew sales 20 %'])])]), empty)
    expect(years.parts.find((p) => p.id === 'results')!.have).toBe(1)
  })

  it('names levels and colours from red to green', () => {
    expect([0, 30, 60, 80, 95].map((n) => levelOf(n).id)).toEqual(['start', 'shape', 'good', 'strong', 'excellent'])
    expect(scoreColor(0)).toContain(' 25)')
    expect(scoreColor(100)).toContain(' 145)')
  })
})
