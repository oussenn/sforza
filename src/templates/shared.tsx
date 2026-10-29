import type { CSSProperties, ReactNode } from 'react'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import {
  faAward,
  faBriefcase,
  faEarthAfrica,
  faEnvelope,
  faFolderOpen,
  faGlobe,
  faGraduationCap,
  faLink,
  faLocationDot,
  faPhone,
  faUser,
} from '@fortawesome/free-solid-svg-icons'
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons'
import { LABELS } from '@shared/templates'
import type {
  Contact,
  ContactType,
  ItemSection,
  Lang,
  ResumeContent,
  ResumeStyle,
  Section,
  SectionType,
} from '@shared/types'

export interface TemplateProps {
  content: ResumeContent
  style: ResumeStyle
  photo: string
  lang: Lang
}

/* ---------------------------------- icons --------------------------------- */

export function FaIcon({ icon, className, style }: { icon: IconDefinition; className?: string; style?: CSSProperties }) {
  const [w, h, , , path] = icon.icon
  return (
    <svg
      className={['fa', className].filter(Boolean).join(' ')}
      style={style}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      {(Array.isArray(path) ? path : [path]).map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

/** Head silhouette with a brain, used for skills. */
function HeadBrainIcon({ className }: { className?: string }) {
  return (
    <svg className={['fa', className].filter(Boolean).join(' ')} viewBox="0 0 512 512" aria-hidden="true">
      <path
        fill="currentColor"
        d="M248 16C136 16 48 100 48 212c0 58 23 108 62 144v116c0 13 11 24 24 24h176c13 0 24-11 24-24v-48h56c31 0 56-25 56-56v-56h24c18 0 32-14 32-32 0-7-2-13-6-19l-54-76C432 92 352 16 248 16z"
      />
      <path
        fill="var(--bg, #fff)"
        d="M150 196c-12-34 18-66 50-58 10-26 50-34 70-14 26-16 62 0 64 32 30 6 40 44 20 64 6 30-22 54-50 46-12 22-46 26-62 8-24 12-54-2-58-28-26-4-40-30-34-50z"
      />
    </svg>
  )
}

/** Document with a rosette, used for certifications. */
function CertificateIcon({ className }: { className?: string }) {
  return (
    <svg className={['fa', className].filter(Boolean).join(' ')} viewBox="0 0 512 512" aria-hidden="true">
      <path fill="currentColor" d="M200 0h150l130 130v334c0 26-22 48-48 48H200c-26 0-48-22-48-48V48c0-26 22-48 48-48z" />
      <path fill="var(--bg, #fff)" d="M350 14v86c0 22 18 40 40 40h76z" />
      <circle cx="150" cy="300" r="120" fill="var(--bg, #fff)" />
      <path fill="currentColor" d="M96 372 72 500l78-36 78 36-24-128z" />
      <circle cx="150" cy="300" r="96" fill="currentColor" />
      <circle cx="150" cy="300" r="40" fill="var(--bg, #fff)" />
    </svg>
  )
}

const SECTION_ICONS: Record<SectionType, IconDefinition | 'brain' | 'certificate'> = {
  summary: faUser,
  experience: faBriefcase,
  projects: faFolderOpen,
  education: faGraduationCap,
  skills: 'brain',
  certifications: 'certificate',
  languages: faEarthAfrica,
  custom: faAward,
}

export function SectionIcon({ type, className }: { type: SectionType; className?: string }) {
  const icon = SECTION_ICONS[type]
  if (icon === 'brain') return <HeadBrainIcon className={className} />
  if (icon === 'certificate') return <CertificateIcon className={className} />
  return <FaIcon icon={icon} className={className} />
}

const CONTACT_ICONS: Record<ContactType, IconDefinition> = {
  email: faEnvelope,
  phone: faPhone,
  location: faLocationDot,
  website: faGlobe,
  linkedin: faLinkedin,
  github: faGithub,
  other: faLink,
}

export function ContactIcon({ type, className }: { type: ContactType; className?: string }) {
  return <FaIcon icon={CONTACT_ICONS[type]} className={className} />
}

export function LinkIcon({ className }: { className?: string }) {
  return <FaIcon icon={faLink} className={['link-icon', className].filter(Boolean).join(' ')} />
}

/* ------------------------------ text helpers ------------------------------ */

export function sectionTitle(section: Section, lang: Lang): string {
  return section.title.trim() || LABELS[lang].sections[section.type]
}

/** "2025/10" (how dates are stored) prints the German way, "10/2025"; anything else ("Expected 2028") as written. */
export function displayDate(value: string): string {
  const m = value.trim().match(/^(\d{4})[/-](\d{1,2})$/)
  return m ? `${m[2].padStart(2, '0')}/${m[1]}` : value.trim()
}

export function dateRange(item: { start?: string; end?: string; current?: boolean }, lang: Lang): string {
  const end = item.current ? LABELS[lang].present : displayDate(item.end ?? '')
  const start = displayDate(item.start ?? '')
  if (start && end) return `${start} – ${end}`
  return start || end
}

export function joinMeta(...parts: (string | undefined | false)[]): string {
  return parts.filter((p): p is string => !!p && !!p.trim()).join(' | ')
}

export function contactHref(c: Contact): string | undefined {
  if (c.url) return c.url
  if (c.type === 'email' && c.value) return `mailto:${c.value}`
  if (c.type === 'phone' && c.value) return `tel:${c.value.replace(/\s+/g, '')}`
  if ((c.type === 'website' || c.type === 'github' || c.type === 'linkedin') && c.value)
    return c.value.startsWith('http') ? c.value : `https://${c.value}`
  return undefined
}

export function MaybeLink({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  )
}

/** Text with the small link icon glued to its last word (never wraps alone). */
export function LinkedText({ text, href, icon = true }: { text: string; href?: string; icon?: boolean }) {
  if (!href || !icon) return <MaybeLink href={href}>{text}</MaybeLink>
  const cut = text.trimEnd().lastIndexOf(' ')
  return (
    <MaybeLink href={href}>
      {cut >= 0 ? text.slice(0, cut + 1) : ''}
      <span className="nowrap">
        {cut >= 0 ? text.slice(cut + 1) : text}
        <LinkIcon />
      </span>
    </MaybeLink>
  )
}

/* ------------------------------ section logic ----------------------------- */

const hasContent = (item: object) =>
  Object.entries(item).some(([k, v]) => k !== 'id' && typeof v === 'string' && v.trim() !== '')

/** Items that are not hidden and not completely empty. */
export function visibleItems<S extends ItemSection>(section: S): S['items'] {
  return section.items.filter((i) => !i.hidden && hasContent(i)) as S['items']
}

export function visibleSections(content: ResumeContent): Section[] {
  return content.sections.filter((s) => {
    if (!s.visible) return false
    if (s.type === 'summary') return !!s.text.trim()
    return visibleItems(s).length > 0
  })
}

export type Group = { kind: 'full'; section: Section } | { kind: 'cols'; main: Section[]; side: Section[] }

/** Consecutive main/side sections share one two-column block; full-width sections break it. */
export function groupMixed(sections: Section[]): Group[] {
  const groups: Group[] = []
  for (const section of sections) {
    if (section.placement === 'full') {
      groups.push({ kind: 'full', section })
      continue
    }
    let last = groups[groups.length - 1]
    if (!last || last.kind !== 'cols') {
      last = { kind: 'cols', main: [], side: [] }
      groups.push(last)
    }
    last[section.placement === 'side' ? 'side' : 'main'].push(section)
  }
  return groups
}

export function splitSidebar(sections: Section[]): { side: Section[]; main: Section[] } {
  return {
    side: sections.filter((s) => s.placement === 'side'),
    main: sections.filter((s) => s.placement !== 'side'),
  }
}

export function Dots({ value, max = 5, className }: { value: number; max?: number; className?: string }) {
  return (
    <span className={['dots', className].filter(Boolean).join(' ')} aria-label={`${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'dot on' : 'dot'} />
      ))}
    </span>
  )
}

export function Photo({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" className={className} draggable={false} />
}
