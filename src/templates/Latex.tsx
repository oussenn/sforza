import { Fragment, type ReactNode } from 'react'
import { InlineText, RichText } from '@/lib/markdown'
import type { Contact, Lang, Section } from '@shared/types'
import { LinkedText, MaybeLink, contactHref, dateRange, sectionTitle, visibleItems, visibleSections, type TemplateProps } from './shared'

/**
 * LaTeX Classic: the widespread LaTeX résumé (Jake Gutierrez's template) in Computer Modern. Centred header
 * with " | " separated contacts, small-caps headings over a full-width rule, and two-row entries whose right
 * column holds the place (top) and the dates (bottom). Languages are one bold-labelled line, not a block.
 */
export default function Latex({ content, lang }: TemplateProps) {
  const { personal } = content
  const contacts = personal.contacts.filter((c) => c.value)
  return (
    <div className="lx">
      <header className="lx-header" data-block="">
        <h1 className="lx-name">{personal.name}</h1>
        {personal.headline && <div className="lx-headline">{personal.headline}</div>}
        {contacts.length > 0 && (
          <div className="lx-contacts">
            {contacts.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 && <span className="lx-sep"> | </span>}
                <MaybeLink href={contactHref(c)} className={underlined(c) ? 'lx-link' : undefined}>
                  {c.value}
                </MaybeLink>
              </Fragment>
            ))}
          </div>
        )}
      </header>
      {visibleSections(content).map((section) => (
        <LxSection key={section.id} section={section} lang={lang} />
      ))}
    </div>
  )
}

/** LaTeX's \underline{\href{…}}: e-mail and web links are underlined, the phone number is not. */
const underlined = (c: Contact) => c.type !== 'phone' && c.type !== 'location' && !!contactHref(c)

function LxSection({ section, lang }: { section: Section; lang: Lang }) {
  const title = sectionTitle(section, lang)
  if (section.type === 'languages') {
    const items = visibleItems(section)
    return (
      <section className="lx-section lx-sec-languages">
        <p className="lx-langs" data-block="">
          <strong>{title}:</strong>{' '}
          {items.map((it, i) => (
            <Fragment key={it.id}>
              {i > 0 && ', '}
              {it.name}
              {it.level && ` (${it.level})`}
            </Fragment>
          ))}
        </p>
      </section>
    )
  }
  const showTitle = section.type !== 'summary' || section.showTitle === true
  return (
    <section className={`lx-section lx-sec-${section.type}`}>
      {showTitle && (
        <h2 className="lx-heading" data-block="" data-keep="" data-heading="">
          {title}
        </h2>
      )}
      <LxBody section={section} lang={lang} />
    </section>
  )
}

function Entry(props: { title: ReactNode; topRight?: string; sub?: ReactNode; bottomRight?: string; description?: string }) {
  const { title, topRight, sub, bottomRight, description } = props
  const hasDesc = !!description?.trim()
  return (
    <div className="lx-entry" data-entry="">
      <div className="lx-head" data-block="" {...(hasDesc ? { 'data-keep': '' } : {})}>
        <div className="lx-row">
          <span className="lx-title">{title}</span>
          {topRight && <span>{topRight}</span>}
        </div>
        {(sub || bottomRight) && (
          <div className="lx-row lx-row2">
            <span>{sub}</span>
            {bottomRight && <span>{bottomRight}</span>}
          </div>
        )}
      </div>
      {hasDesc && <RichText text={description!} className="lx-desc" />}
    </div>
  )
}

function LxBody({ section, lang }: { section: Section; lang: Lang }) {
  switch (section.type) {
    case 'summary':
      return <RichText text={section.text} className="lx-summary" />
    case 'experience':
      return (
        <div className="lx-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.position}
              topRight={it.location}
              sub={<LinkedText text={it.company} href={it.url} />}
              bottomRight={dateRange(it, lang)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'education':
      return (
        <div className="lx-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.degree}
              topRight={it.location}
              sub={<LinkedText text={it.school} href={it.url} />}
              bottomRight={dateRange(it, lang)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'custom':
      return (
        <div className="lx-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.title}
              topRight={it.location}
              sub={it.subtitle ? <LinkedText text={it.subtitle} href={it.url} /> : undefined}
              bottomRight={dateRange(it, lang)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'projects':
      // \resumeProjectHeading: "Name | subtitle" on one line, dates on the right.
      return (
        <div className="lx-entries">
          {visibleItems(section).map((it) => {
            const hasDesc = !!it.description?.trim()
            return (
              <div key={it.id} className="lx-entry" data-entry="">
                <div className="lx-row lx-project" data-block="" {...(hasDesc ? { 'data-keep': '' } : {})}>
                  <span>
                    <strong>
                      <LinkedText text={it.name} href={it.url} />
                    </strong>
                    {it.subtitle && (
                      <>
                        {' | '}
                        <em>{it.subtitle}</em>
                      </>
                    )}
                  </span>
                  {dateRange(it, lang) && <span>{dateRange(it, lang)}</span>}
                </div>
                {hasDesc && <RichText text={it.description} className="lx-desc" />}
              </div>
            )
          })}
        </div>
      )
    case 'certifications':
      return (
        <div className="lx-lines">
          {visibleItems(section).map((it) => (
            <div key={it.id} className="lx-row lx-line" data-block="">
              <span>
                <strong>
                  <LinkedText text={it.name} href={it.url} />
                </strong>
                {it.issuer && (
                  <>
                    {' | '}
                    <em>{it.issuer}</em>
                  </>
                )}
              </span>
              {it.date && <span>{it.date}</span>}
            </div>
          ))}
        </div>
      )
    case 'skills':
      return (
        <div className="lx-lines lx-skills">
          {visibleItems(section).map((it) => (
            <div key={it.id} className="lx-line" data-block="">
              <strong>{it.name}</strong>
              {it.details && (
                <>
                  {' : '}
                  <InlineText text={it.details} />
                </>
              )}
            </div>
          ))}
        </div>
      )
    case 'languages':
      return null
  }
}
