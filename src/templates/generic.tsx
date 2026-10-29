import type { ReactNode } from 'react'
import { InlineText, RichText } from '@/lib/markdown'
import type { Contact, Lang, Section } from '@shared/types'
import {
  ContactIcon,
  Dots,
  LinkedText,
  MaybeLink,
  contactHref,
  dateRange,
  sectionTitle,
  visibleItems,
} from './shared'

/**
 * Configurable section renderer shared by the non-signature templates.
 * Class names are prefixed (`${p}-…`) so each template styles its own look in CSS.
 */
export interface Parts {
  p: string
  /** stacked: title/sub/meta lines · rail: dates in a left column · split: dates right-aligned */
  entry: 'stacked' | 'rail' | 'split'
  /** Experience shows the company as the title and the position as the subtitle. */
  companyFirst?: boolean
  skills: 'grid2' | 'grid3' | 'list' | 'rated'
  languages: 'dots' | 'text' | 'grid'
  certs: 'list' | 'grid'
  summaryTitle: boolean
  Heading: (props: { section: Section; title: string }) => ReactNode
}

/** `g-name p-name`: shared base styles + template-specific overrides. */
const classes = (p: string) => (name: string) => `g-${name} ${p}-${name}`

interface EntryData {
  id: string
  title: string
  titleUrl?: string
  sub?: string
  subUrl?: string
  date?: string
  location?: string
  description?: string
}

function Entry({ e, parts, rail = true }: { e: EntryData; parts: Parts; rail?: boolean }) {
  const cx = classes(parts.p)
  const hasDesc = !!e.description?.trim()
  const keep = hasDesc ? { 'data-keep': '' } : {}
  const title = e.title ? <LinkedText text={e.title} href={e.titleUrl} /> : null
  const sub = e.sub ? <LinkedText text={e.sub} href={e.subUrl} /> : null
  const desc = hasDesc ? <RichText text={e.description!} className={`${cx('desc')}`} /> : null

  if (parts.entry === 'rail') {
    return (
      <div className={`${cx('entry')}`} data-entry="">
        <div className={`${cx('head')} ${cx('railhead')}${rail ? '' : ' g-norail'}`} data-block="" {...keep}>
          {rail && (
            <div className={`${cx('rail')}`}>
              {e.date && <div className={`${cx('date')}`}>{e.date}</div>}
              {e.location && <div className={`${cx('loc')}`}>{e.location}</div>}
            </div>
          )}
          <div className={`${cx('headmain')}`}>
            {title && <div className={`${cx('title')}`}>{title}</div>}
            {sub && <div className={`${cx('sub')}`}>{sub}</div>}
          </div>
        </div>
        {desc && <div className={`${cx('railbody')}${rail ? '' : ' g-norail'}`}>{desc}</div>}
      </div>
    )
  }

  if (parts.entry === 'split') {
    return (
      <div className={`${cx('entry')}`} data-entry="">
        <div className={`${cx('head')}`} data-block="" {...keep}>
          <div className={`${cx('row')}`}>
            <div className={`${cx('title')}`}>{title}</div>
            {e.date && <div className={`${cx('date')}`}>{e.date}</div>}
          </div>
          {(sub || e.location) && (
            <div className={`${cx('row')}`}>
              <div className={`${cx('sub')}`}>{sub}</div>
              {e.location && <div className={`${cx('loc')}`}>{e.location}</div>}
            </div>
          )}
        </div>
        {desc}
      </div>
    )
  }

  const meta = [e.date, e.location].filter(Boolean).join(' | ')
  return (
    <div className={`${cx('entry')}`} data-entry="">
      <div className={`${cx('head')}`} data-block="" {...keep}>
        {title && <div className={`${cx('title')}`}>{title}</div>}
        {sub && <div className={`${cx('sub')}`}>{sub}</div>}
        {meta && <div className={`${cx('meta')}`}>{meta}</div>}
      </div>
      {desc}
    </div>
  )
}

function entriesOf(section: Section, lang: Lang, parts: Parts): EntryData[] {
  switch (section.type) {
    case 'experience':
      return visibleItems(section).map((it) => ({
        id: it.id,
        title: parts.companyFirst ? it.company : it.position,
        titleUrl: parts.companyFirst ? it.url : undefined,
        sub: parts.companyFirst ? it.position : it.company,
        subUrl: parts.companyFirst ? undefined : it.url,
        date: dateRange(it, lang),
        location: it.location,
        description: it.description,
      }))
    case 'projects':
      return visibleItems(section).map((it) => ({
        id: it.id,
        title: it.name,
        titleUrl: it.url,
        sub: it.subtitle,
        date: dateRange(it, lang),
        description: it.description,
      }))
    case 'education':
      return visibleItems(section).map((it) => ({
        id: it.id,
        title: it.degree,
        sub: it.school,
        subUrl: it.url,
        date: dateRange(it, lang),
        location: it.location,
        description: it.description,
      }))
    case 'custom':
      return visibleItems(section).map((it) => ({
        id: it.id,
        title: it.title,
        sub: it.subtitle,
        subUrl: it.url,
        date: dateRange(it, lang),
        location: it.location,
        description: it.description,
      }))
    default:
      return []
  }
}

export function SectionBody({ section, lang, parts }: { section: Section; lang: Lang; parts: Parts }) {
  const cx = classes(parts.p)
  switch (section.type) {
    case 'summary':
      return <RichText text={section.text} className={`${cx('summary')}`} />
    case 'experience':
    case 'projects':
    case 'education':
    case 'custom': {
      const entries = entriesOf(section, lang, parts)
      // A date column with nothing in it (projects without dates) would only be white space: use the full width.
      const rail = entries.some((e) => e.date || e.location)
      return (
        <div className={`${cx('entries')}`}>
          {entries.map((e) => (
            <Entry key={e.id} e={e} parts={parts} rail={rail} />
          ))}
        </div>
      )
    }
    case 'skills': {
      const items = visibleItems(section)
      if (parts.skills === 'rated') {
        return (
          <div className={`${cx('rated')}`}>
            {items.map((it) => (
              <div key={it.id} className={`${cx('rated-row')}`} data-block="">
                <div className={`${cx('rated-name')}`}>
                  <span className={`${cx('skill-name')}`}>{it.name}</span>
                  {it.details && (
                    <span className={`${cx('skill-details')}`}>
                      <InlineText text={it.details} />
                    </span>
                  )}
                </div>
                {it.level > 0 && <Dots value={it.level} />}
              </div>
            ))}
          </div>
        )
      }
      return (
        <div className={`${cx('skills')} ${cx('skills-' + parts.skills)}`}>
          {items.map((it) => (
            <div key={it.id} className={`${cx('skill')}`} data-block="">
              <div className={`${cx('skill-name')}`}>
                <span>{it.name}</span>
                {it.level > 0 && <Dots value={it.level} />}
              </div>
              {it.details && (
                <div className={`${cx('skill-details')}`}>
                  <InlineText text={it.details} />
                </div>
              )}
            </div>
          ))}
        </div>
      )
    }
    case 'languages': {
      const items = visibleItems(section)
      if (parts.languages === 'text') {
        return (
          <div className={`${cx('langs-text')}`} data-block="">
            {items.map((it, i) => (
              <span key={it.id}>
                <strong>{it.name}</strong>
                {it.level && ` (${it.level})`}
                {i < items.length - 1 && <span className={`${cx('sep')}`}> · </span>}
              </span>
            ))}
          </div>
        )
      }
      return (
        <div className={`${cx('langs')} ${cx('langs-' + parts.languages)}`}>
          {items.map((it) => (
            <div key={it.id} className={`${cx('lang')}`} data-block="">
              <span className={`${cx('lang-name')}`}>
                {it.name}
                {it.level && <span className={`${cx('lang-level')}`}> {it.level}</span>}
              </span>
              {it.rating > 0 && <Dots value={it.rating} />}
            </div>
          ))}
        </div>
      )
    }
    case 'certifications': {
      const items = visibleItems(section)
      return (
        <div className={`${cx('certs')} ${cx('certs-' + parts.certs)}`}>
          {items.map((it) => (
            <div key={it.id} className={`${cx('cert')}`} data-block="">
              <span className={`${cx('cert-name')}`}>
                <LinkedText text={it.name} href={it.url} />
              </span>
              {(it.issuer || it.date) && (
                <span className={`${cx('cert-meta')}`}>{[it.issuer, it.date].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          ))}
        </div>
      )
    }
  }
}

export function Sections({ sections, lang, parts }: { sections: Section[]; lang: Lang; parts: Parts }) {
  const { Heading } = parts
  const cx = classes(parts.p)
  return (
    <>
      {sections.map((section) => {
        const showTitle = section.type !== 'summary' || (section.showTitle ?? parts.summaryTitle)
        return (
          <section key={section.id} className={`${cx('section')} ${cx('sec-' + section.type)}`} data-type={section.type}>
            {showTitle && (
              <div className={`${cx('heading-wrap')}`} data-block="" data-keep="" data-heading="">
                <Heading section={section} title={sectionTitle(section, lang)} />
              </div>
            )}
            <SectionBody section={section} lang={lang} parts={parts} />
          </section>
        )
      })}
    </>
  )
}

export function Contacts({
  contacts,
  className,
  icons = true,
}: {
  contacts: Contact[]
  className?: string
  icons?: boolean
}) {
  return (
    <div className={['g-contacts', className].filter(Boolean).join(' ')}>
      {contacts
        .filter((c) => c.value)
        .map((c) => (
          <MaybeLink key={c.id} href={contactHref(c)} className="g-contact">
            {icons && <ContactIcon type={c.type} />}
            <span>{c.value}</span>
          </MaybeLink>
        ))}
    </div>
  )
}
