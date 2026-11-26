import type { ExperienceItem, Library, ProjectItem, ResumeContent, SkillItem } from './types'

/**
 * How well stocked an account's knowledge is: its master CV and its knowledge base together, since a tailored CV
 * or letter can only pick from those two. Each part has a minimum for good tailoring (TARGETS); the score is the
 * weighted share of those minimums reached, 0 to 100, and the next steps say what adds the most.
 */

export type KbPartId = 'experience' | 'projects' | 'skills' | 'results' | 'education' | 'notes'

export interface KbPart {
  id: KbPartId
  label: string
  /** how much of the minimum is there, in the part's unit (roles, projects, skills, results, items, words) */
  have: number
  target: number
  unit: string
  /** 0..1 of the minimum reached */
  ratio: number
  /** points of the score this part is worth, and how many it gives now */
  weight: number
  points: number
  /** what counts, in one line */
  rule: string
}

export interface KbStep {
  part: KbPartId
  text: string
  /** points this step adds to the score */
  gain: number
}

export interface KbLevel {
  id: 'start' | 'shape' | 'good' | 'strong' | 'excellent'
  label: string
  /** what this level means for tailoring */
  says: string
}

export interface KbScore {
  score: number
  level: KbLevel
  parts: KbPart[]
  next: KbStep[]
}

/** The minimums for good tailoring, and what each part is worth (they add up to 100). */
export const TARGETS: Record<KbPartId, { target: number; weight: number }> = {
  experience: { target: 3, weight: 25 },
  projects: { target: 6, weight: 25 },
  skills: { target: 20, weight: 15 },
  results: { target: 8, weight: 15 },
  education: { target: 5, weight: 10 },
  notes: { target: 150, weight: 10 },
}

export const LEVELS: (KbLevel & { from: number })[] = [
  { id: 'excellent', from: 90, label: 'Excellent', says: 'Every job finds what it needs here.' },
  { id: 'strong', from: 75, label: 'Strong', says: 'Tailoring has plenty to choose from.' },
  { id: 'good', from: 50, label: 'Good', says: 'Good for most jobs; some will find gaps.' },
  { id: 'shape', from: 25, label: 'Taking shape', says: 'Tailored CVs repeat the same few points.' },
  { id: 'start', from: 0, label: 'Just started', says: 'Tailoring has little to work with yet.' },
]

export const levelOf = (score: number): KbLevel => {
  const { from: _from, ...level } = LEVELS.find((l) => score >= l.from) ?? LEVELS[LEVELS.length - 1]
  return level
}

/** Red at 0, through orange and yellow, green at 100 (OKLCH hue 25 → 145). */
export const scoreColor = (score: number) => `oklch(0.68 0.19 ${Math.round(25 + Math.max(0, Math.min(100, score)) * 1.2)})`

/** The points of a description: its non-empty lines, bullet marks and markdown left out. */
export function points(description: string | undefined): string[] {
  return (description ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').replace(/[*_`]/g, '').trim())
    .filter((l) => l.length > 2)
}

/** A point with a figure in it (12 dashboards, 30 %, 2x faster); years and dates alone do not count. */
const MEASURED = /\d/
const hasFigure = (line: string) =>
  MEASURED.test(line.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}[./]\d{4}\b/g, '').replace(/\b(19|20)\d{2}\b/g, ''))

const key = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim().toLowerCase()).join('|')

function items<T>(content: ResumeContent | null, type: string): T[] {
  return (content?.sections ?? []).filter((s) => s.type === type && 'items' in s).flatMap((s) => ('items' in s ? (s.items as unknown as T[]) : []))
}

/** Distinct skills: a skill item with details is a group ("Languages: Python, SQL"), its details the skills. */
export function skillNames(list: Pick<SkillItem, 'name' | 'details'>[]): Set<string> {
  const out = new Set<string>()
  for (const s of list) {
    const parts = s.details?.trim() ? s.details.split(/[,;·•|\n]|\s\/\s|\band\b|\bund\b/) : [s.name ?? '']
    for (const p of parts) {
      const name = p.replace(/[*_`]/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase()
      if (name.length >= 1 && name.length <= 40) out.add(name)
    }
  }
  return out
}

const words = (text: string) => (text.replace(/[#*_`>[\]()-]/g, ' ').match(/[\p{L}\p{N}]{2,}/gu) ?? []).length
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The knowledge score of a master CV (its source language) and a knowledge base. */
export function knowledgeScore(content: ResumeContent | null, library: Library | null): KbScore {
  const lib: Library = library ?? { projects: [], skills: [], experience: [], certifications: [], notes: '' }

  // Roles and projects of the CV and the knowledge base, once each; the fuller version of a duplicate counts.
  const merge = <T>(list: T[], id: (t: T) => string, size: (t: T) => number) => {
    const by = new Map<string, T>()
    for (const t of list) {
      const k = id(t)
      if (k === '|' || k === '') continue
      const was = by.get(k)
      if (!was || size(t) > size(was)) by.set(k, t)
    }
    return [...by.values()]
  }
  const roles = merge(
    [...items<ExperienceItem>(content, 'experience'), ...lib.experience].filter((r) => !r.hidden),
    (r) => key(r.position, r.company),
    (r) => points(r.description).length,
  )
  const projects = merge(
    [...items<ProjectItem>(content, 'projects'), ...lib.projects].filter((p) => !p.hidden),
    (p) => key(p.name),
    (p) => (p.description ?? '').length,
  )
  const skills = skillNames([...items<SkillItem>(content, 'skills'), ...lib.skills])
  const measured = [...roles.map((r) => r.description), ...projects.map((p) => p.description)].flatMap(points).filter(hasFigure).length
  const degrees = items<{ degree?: string; school?: string }>(content, 'education').filter((e) => (e.degree ?? '').trim() || (e.school ?? '').trim()).length
  const certificates = new Set([...items<{ name?: string }>(content, 'certifications'), ...lib.certifications].map((c) => key(c.name)).filter((k) => k)).size
  const languages = items<{ name?: string }>(content, 'languages').filter((l) => (l.name ?? '').trim()).length
  const noteWords = words(lib.notes ?? '')

  // A role counts fully with 3 points, a project with 2 points or a paragraph; less counts in part.
  const roleValue = roles.reduce((sum, r) => sum + Math.min(1, points(r.description).length / 3), 0)
  const projectValue = projects.reduce((sum, p) => {
    const n = points(p.description).length
    return sum + (n >= 2 || (p.description ?? '').length >= 120 ? 1 : n === 1 ? 0.6 : 0.3)
  }, 0)
  const educationValue = Math.min(degrees, 1) + Math.min(certificates, 2) + Math.min(languages, 2)

  const part = (id: KbPartId, label: string, value: number, have: number, unit: string, rule: string): KbPart => {
    const { target, weight } = TARGETS[id]
    const ratio = Math.max(0, Math.min(1, value / target))
    return { id, label, have, target, unit, ratio, weight, points: Math.round(weight * ratio * 10) / 10, rule }
  }
  const parts: KbPart[] = [
    part('experience', 'Work experience', roleValue, roles.filter((r) => points(r.description).length >= 3).length, 'roles', 'Roles with at least 3 points each'),
    part('projects', 'Projects', projectValue, projects.filter((p) => points(p.description).length >= 2 || (p.description ?? '').length >= 120).length, 'projects', 'Projects with what you built and how'),
    part('skills', 'Skills', skills.size, skills.size, 'skills', 'Tools, languages and methods, counted once each'),
    part('results', 'Results with numbers', measured, measured, 'results', 'Points with a figure: time saved, users, accuracy, scale'),
    part('education', 'Education, certificates, languages', educationValue, educationValue, 'items', 'A degree, 2 certificates or courses, 2 languages'),
    part('notes', 'Notes and context', noteWords, noteWords, 'words', 'Context a CV line cannot hold: side work, awards, details'),
  ]
  const score = Math.round(parts.reduce((s, p) => s + p.weight * p.ratio, 0))

  const missing = (p: KbPart) => Math.max(0, p.target - p.have)
  const tip = (p: KbPart): string => {
    const k = missing(p)
    switch (p.id) {
      case 'experience':
        return roles.length >= p.target
          ? `Give your roles at least 3 points each: what you did, with what, and the result`
          : `Describe ${plural(Math.max(1, k), 'more role')} with at least 3 points each (jobs, working student posts, internships)`
      case 'projects':
        return `Add ${plural(Math.max(1, k), 'more project')}: what you built, the tools, and what came out of it`
      case 'skills':
        return `Add ${plural(k, 'more skill')}: tools, programming languages, methods`
      case 'results':
        return `Put a figure on ${plural(k, 'more result')}: time saved, users, accuracy, money, scale`
      case 'education':
        return degrees < 1
          ? 'Add your degree to your master CV'
          : certificates < 2
            ? `Add ${plural(2 - certificates, 'certificate')} or course${2 - certificates === 1 ? '' : 's'}`
            : 'List your languages with their level in your master CV'
      case 'notes':
        return `Write about ${Math.max(20, Math.ceil(k / 10) * 10)} more words of notes: context, side work, awards, details`
    }
  }
  const next = parts
    .filter((p) => p.ratio < 1)
    .map((p) => ({ part: p.id, text: tip(p), gain: Math.round(p.weight * (1 - p.ratio)) }))
    .sort((a, b) => b.gain - a.gain)

  return { score, level: levelOf(score), parts, next }
}
