import type { Lang, Placement, ResumeStyle, SectionType, TemplateId } from './types'

export type LayoutKind = 'mixed' | 'sidebar' | 'single'

export interface TemplateMeta {
  id: TemplateId
  name: string
  description: string
  layout: LayoutKind
  /** Heading shown for the summary section unless the section overrides it. */
  summaryTitle: boolean
  style: ResumeStyle
  placement: Partial<Record<SectionType, Placement>>
}

const base: ResumeStyle = {
  accent: '#000000',
  text: '#1f1f1f',
  background: '#ffffff',
  font: 'Open Sans',
  headingFont: '',
  fontSize: 9.5,
  lineHeight: 1.184,
  marginX: 14,
  marginY: 9.5,
  sectionGap: 14.4,
  itemGap: 9,
  columnRatio: 51,
  showPhoto: true,
  photoSize: 115,
  showIcons: true,
}

const mixedPlacement: TemplateMeta['placement'] = {
  summary: 'full',
  experience: 'main',
  projects: 'side',
  education: 'side',
  languages: 'side',
  skills: 'full',
  certifications: 'full',
  custom: 'side',
}

const sidebarPlacement: TemplateMeta['placement'] = {
  summary: 'side',
  languages: 'side',
  certifications: 'side',
  custom: 'side',
  experience: 'main',
  projects: 'main',
  education: 'main',
  skills: 'main',
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'signature',
    name: 'Signature',
    description: 'Teal two-column layout: the original master CV design.',
    layout: 'mixed',
    summaryTitle: false,
    style: { ...base, background: '#fffcf9' },
    placement: mixedPlacement,
  },
  {
    id: 'atlantic',
    name: 'Atlantic Blue',
    description: 'Dark navy sidebar with photo, contact and profile.',
    layout: 'sidebar',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#1e3a52',
      text: '#2a2f36',
      font: 'Lato',
      fontSize: 9,
      lineHeight: 1.35,
      marginX: 10,
      marginY: 12,
      sectionGap: 16,
      itemGap: 10,
      columnRatio: 34,
      photoSize: 110,
    },
    placement: sidebarPlacement,
  },
  {
    id: 'mercury',
    name: 'Mercury Flow',
    description: 'Soft grey header, centred headings, dates in a side rail.',
    layout: 'single',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#3f4a5a',
      text: '#23272e',
      font: 'Merriweather',
      fontSize: 8.5,
      lineHeight: 1.45,
      marginX: 14,
      marginY: 12,
      sectionGap: 14,
      itemGap: 10,
      photoSize: 84,
    },
    placement: {},
  },
  {
    id: 'steady',
    name: 'Steady Form',
    description: 'Clean sans-serif with banded headings and dates on the right.',
    layout: 'single',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#2f7d4f',
      text: '#1f2933',
      font: 'Source Sans 3',
      fontSize: 9.5,
      lineHeight: 1.3,
      marginX: 13,
      marginY: 11,
      sectionGap: 12,
      itemGap: 8,
      photoSize: 78,
    },
    placement: {},
  },
  {
    id: 'serif',
    name: 'Classic Serif',
    description: 'Centred serif header with ruled uppercase headings.',
    layout: 'single',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#1b1b1b',
      text: '#1b1b1b',
      font: 'Source Serif 4',
      fontSize: 9.5,
      lineHeight: 1.3,
      marginX: 15,
      marginY: 12,
      sectionGap: 12,
      itemGap: 7,
      showPhoto: false,
      showIcons: true,
    },
    placement: {},
  },
  {
    id: 'leaves',
    name: 'Leaves',
    description: 'Botanical side strip with a friendly modern sans.',
    layout: 'single',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#23422f',
      text: '#1c2420',
      font: 'Poppins',
      fontSize: 8.5,
      lineHeight: 1.4,
      marginX: 12,
      marginY: 12,
      sectionGap: 14,
      itemGap: 9,
      photoSize: 96,
    },
    placement: {},
  },
  {
    id: 'executive',
    name: 'Executive',
    description: 'Traditional serif with a date rail and rated skills.',
    layout: 'single',
    summaryTitle: true,
    style: {
      ...base,
      accent: '#1f1f1f',
      text: '#1f1f1f',
      font: 'Tinos',
      fontSize: 10,
      lineHeight: 1.3,
      marginX: 16,
      marginY: 13,
      sectionGap: 12,
      itemGap: 8,
      showPhoto: false,
    },
    placement: {},
  },
  {
    id: 'latex',
    name: 'LaTeX Classic',
    description: 'The classic LaTeX résumé in Computer Modern: small-caps ruled headings, two-row entries.',
    layout: 'single',
    summaryTitle: false,
    style: {
      ...base,
      accent: '#000000',
      text: '#000000',
      font: 'CMU Serif',
      fontSize: 11,
      lineHeight: 1.24,
      // A4 with the 7.5in text width of the LaTeX original
      marginX: 9.75,
      marginY: 11,
      sectionGap: 19,
      itemGap: 10,
      showPhoto: false,
      showIcons: false,
    },
    placement: {},
  },
]

export const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<TemplateId, TemplateMeta>

export const FONTS = [
  'Open Sans',
  'Noto Sans',
  'Lato',
  'Source Sans 3',
  'Roboto',
  'Inter',
  'Poppins',
  'Montserrat',
  'IBM Plex Sans',
  'Merriweather',
  'Source Serif 4',
  'Lora',
  'EB Garamond',
  'Tinos',
  'CMU Serif',
] as const

export const ACCENTS = ['#000000', '#348aa7', '#1e3a52', '#2f7d4f', '#7c3aed', '#b45309', '#be123c', '#0f766e', '#374151', '#1b1b1b']

export const LABELS: Record<
  Lang,
  { present: string; sections: Record<SectionType, string>; page: string }
> = {
  en: {
    present: 'Present',
    page: 'Page',
    sections: {
      summary: 'Profile',
      experience: 'Professional Experience',
      projects: 'Projects',
      education: 'Education',
      skills: 'Technical Skills',
      certifications: 'Certifications',
      languages: 'Languages',
      custom: 'Awards',
    },
  },
  fr: {
    present: 'Aujourd’hui',
    page: 'Page',
    sections: {
      summary: 'Profil',
      experience: 'Expérience professionnelle',
      projects: 'Projets',
      education: 'Formation',
      skills: 'Compétences techniques',
      certifications: 'Certifications',
      languages: 'Langues',
      custom: 'Distinctions',
    },
  },
  de: {
    present: 'heute',
    page: 'Seite',
    sections: {
      summary: 'Profil',
      experience: 'Berufserfahrung',
      projects: 'Projekte',
      education: 'Ausbildung',
      skills: 'Technische Kenntnisse',
      certifications: 'Zertifikate',
      languages: 'Sprachen',
      custom: 'Auszeichnungen',
    },
  },
}
