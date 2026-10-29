import type { SectionItem, SectionType } from '@shared/types'
import { plainText } from '@/lib/markdown'

export type ItemType = Exclude<SectionType, 'summary'>

export interface FieldDef {
  key: string
  label: string
  kind: 'text' | 'url' | 'rich' | 'switch' | 'rating' | 'textarea'
  placeholder?: string
  /** occupy the full row (default: half) */
  wide?: boolean
}

const DATES: FieldDef[] = [
  { key: 'start', label: 'Start', kind: 'text', placeholder: '2024/06' },
  { key: 'end', label: 'End', kind: 'text', placeholder: '2025/03 or Expected 2028' },
]

export const FIELDS: Record<ItemType, FieldDef[]> = {
  experience: [
    { key: 'position', label: 'Job title', kind: 'text', placeholder: 'Data Analyst' },
    { key: 'company', label: 'Employer', kind: 'text', placeholder: 'Acme Corp' },
    { key: 'url', label: 'Employer link', kind: 'url', placeholder: 'https://…' },
    { key: 'location', label: 'Location', kind: 'text', placeholder: 'Berlin, Germany · Hybrid' },
    ...DATES,
    { key: 'current', label: 'I currently work here', kind: 'switch', wide: true },
    { key: 'description', label: 'Description', kind: 'rich', wide: true },
  ],
  projects: [
    { key: 'name', label: 'Project name', kind: 'text', wide: true },
    { key: 'subtitle', label: 'Subtitle', kind: 'text', placeholder: 'Role, stack or context' },
    { key: 'url', label: 'Link', kind: 'url', placeholder: 'https://github.com/…' },
    ...DATES,
    { key: 'description', label: 'Description', kind: 'rich', wide: true },
  ],
  education: [
    { key: 'degree', label: 'Degree', kind: 'text', wide: true },
    { key: 'school', label: 'School', kind: 'text' },
    { key: 'url', label: 'School link', kind: 'url', placeholder: 'https://…' },
    { key: 'location', label: 'Location', kind: 'text', wide: true },
    ...DATES,
    { key: 'current', label: 'Currently studying here', kind: 'switch', wide: true },
    { key: 'description', label: 'Description', kind: 'rich', wide: true },
  ],
  skills: [
    { key: 'name', label: 'Group', kind: 'text', placeholder: 'Data & Analytics' },
    { key: 'level', label: 'Level (optional)', kind: 'rating' },
    { key: 'details', label: 'Skills', kind: 'textarea', placeholder: 'SQL, Python, Power BI…', wide: true },
  ],
  certifications: [
    { key: 'name', label: 'Certificate', kind: 'text', wide: true },
    { key: 'issuer', label: 'Issuer', kind: 'text' },
    { key: 'date', label: 'Date', kind: 'text' },
    { key: 'url', label: 'Link', kind: 'url', wide: true, placeholder: 'https://coursera.org/verify/…' },
  ],
  languages: [
    { key: 'name', label: 'Language', kind: 'text' },
    { key: 'level', label: 'Level', kind: 'text', placeholder: 'C1' },
    { key: 'rating', label: 'Rating (for dot templates)', kind: 'rating', wide: true },
  ],
  custom: [
    { key: 'title', label: 'Title', kind: 'text', wide: true },
    { key: 'subtitle', label: 'Subtitle', kind: 'text' },
    { key: 'url', label: 'Link', kind: 'url' },
    { key: 'location', label: 'Location', kind: 'text', wide: true },
    ...DATES,
    { key: 'description', label: 'Description', kind: 'rich', wide: true },
  ],
}

const get = (item: SectionItem, key: string): string => {
  const v = (item as unknown as Record<string, unknown>)[key]
  return typeof v === 'string' ? plainText(v) : ''
}

/** Primary / secondary labels for collapsed item rows. */
export function itemLabels(type: ItemType, item: SectionItem): { title: string; subtitle: string } {
  switch (type) {
    case 'experience':
      return { title: get(item, 'position'), subtitle: [get(item, 'company'), get(item, 'start')].filter(Boolean).join(' · ') }
    case 'projects':
      return { title: get(item, 'name'), subtitle: get(item, 'subtitle') || get(item, 'url').replace(/^https?:\/\//, '') }
    case 'education':
      return { title: get(item, 'degree'), subtitle: get(item, 'school') }
    case 'skills':
      return { title: get(item, 'name'), subtitle: get(item, 'details') }
    case 'certifications':
      return { title: get(item, 'name'), subtitle: get(item, 'issuer') }
    case 'languages':
      return { title: get(item, 'name'), subtitle: get(item, 'level') }
    case 'custom':
      return { title: get(item, 'title'), subtitle: get(item, 'subtitle') }
  }
}

export const ITEM_NOUN: Record<ItemType, string> = {
  experience: 'experience',
  projects: 'project',
  education: 'education',
  skills: 'skill group',
  certifications: 'certificate',
  languages: 'language',
  custom: 'entry',
}
