import { InlineText, RichText } from '@/lib/markdown'
import type { Lang, Section } from '@shared/types'
import {
  ContactIcon,
  Dots,
  LinkIcon,
  LinkedText,
  MaybeLink,
  Photo,
  contactHref,
  dateRange,
  groupMixed,
  joinMeta,
  sectionTitle,
  visibleItems,
  visibleSections,
  type TemplateProps,
} from './shared'

/** Template 1: pixel-matched to the original FlowCV master CV. */
export default function Signature({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  const groups = groupMixed(visibleSections(content))
  return (
    <div className="sig">
      <header className="sig-header" data-block="">
        <div className="sig-id">
          <h1 className="sig-name">{personal.name}</h1>
          {personal.headline && <div className="sig-headline">{personal.headline}</div>}
          <div className="sig-contacts">
            {personal.contacts
              .filter((c) => c.value)
              .map((c) => (
                // A long value gets a whole row: an ellipsis would also cut it in the PDF text that ATS read.
                <MaybeLink key={c.id} href={contactHref(c)} className={c.value.length > 32 ? 'sig-contact sig-contact-wide' : 'sig-contact'}>
                  <ContactIcon type={c.type} className="sig-contact-icon" />
                  <span>{c.value}</span>
                </MaybeLink>
              ))}
          </div>
        </div>
        {style.showPhoto && photo && <Photo src={photo} className="sig-photo" />}
      </header>
      <div className="sig-body">
        {groups.map((g, i) =>
          g.kind === 'full' ? (
            <SigSection key={g.section.id} section={g.section} lang={lang} wide />
          ) : (
            <div key={i} className="sig-cols">
              <div className="sig-col sig-col-main" data-col="main">
                {g.main.map((s) => (
                  <SigSection key={s.id} section={s} lang={lang} />
                ))}
              </div>
              <div className="sig-col sig-col-side" data-col="side">
                {g.side.map((s) => (
                  <SigSection key={s.id} section={s} lang={lang} />
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function SigSection({ section, lang, wide = false }: { section: Section; lang: Lang; wide?: boolean }) {
  const showTitle = section.type !== 'summary' || section.showTitle === true
  return (
    <section className={`sig-section sig-sec-${section.type}`} data-type={section.type}>
      {showTitle && (
        <h2 className="sig-heading" data-block="" data-keep="" data-heading="">
          {/* Plain headings: the icons stay on the contact line only (cleaner print, reliable ATS parsing). */}
          <span className="sig-heading-inner">
            <span>{sectionTitle(section, lang)}</span>
          </span>
        </h2>
      )}
      <SigBody section={section} lang={lang} wide={wide} />
    </section>
  )
}

function Entry(props: {
  title: string
  titleUrl?: string
  sub?: string
  subUrl?: string
  meta?: string
  description?: string
}) {
  const { title, titleUrl, sub, subUrl, meta, description } = props
  const hasDesc = !!description?.trim()
  return (
    <div className="sig-entry" data-entry="">
      <div className={meta ? 'sig-entry-head has-meta' : 'sig-entry-head'} data-block="" {...(hasDesc ? { 'data-keep': '' } : {})}>
        {title && (
          <div className="sig-title">
            <LinkedText text={title} href={titleUrl} />
          </div>
        )}
        {sub && (
          <div className="sig-sub">
            <LinkedText text={sub} href={subUrl} />
          </div>
        )}
        {meta && <div className="sig-meta">{meta}</div>}
      </div>
      {hasDesc && <RichText text={description!} className="sig-desc" />}
    </div>
  )
}

function SigBody({ section, lang, wide }: { section: Section; lang: Lang; wide: boolean }) {
  switch (section.type) {
    case 'summary':
      return <RichText text={section.text} className="sig-summary" />
    case 'experience':
      return (
        <div className="sig-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.position}
              sub={it.company}
              subUrl={it.url}
              meta={joinMeta(dateRange(it, lang), it.location)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'projects':
      return (
        <div className="sig-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.name}
              titleUrl={it.url}
              sub={it.subtitle}
              meta={dateRange(it, lang)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'education':
      return (
        <div className="sig-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.degree}
              sub={it.school}
              subUrl={it.url}
              meta={joinMeta(dateRange(it, lang), it.location)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'custom':
      return (
        <div className="sig-entries">
          {visibleItems(section).map((it) => (
            <Entry
              key={it.id}
              title={it.title}
              sub={it.subtitle}
              subUrl={it.url}
              meta={joinMeta(dateRange(it, lang), it.location)}
              description={it.description}
            />
          ))}
        </div>
      )
    case 'skills':
      return (
        <div className={wide ? 'sig-skills sig-skills-grid' : 'sig-skills'}>
          {visibleItems(section).map((it) => (
            <div key={it.id} className="sig-skill" data-block="">
              <div className="sig-title sig-skill-name">
                <span>{it.name}</span>
                {it.level > 0 && <Dots value={it.level} />}
              </div>
              {it.details && (
                <div>
                  <InlineText text={it.details} />
                </div>
              )}
            </div>
          ))}
        </div>
      )
    case 'certifications':
      return (
        <div className="sig-chips" data-block="">
          {visibleItems(section).map((it) => (
            <MaybeLink key={it.id} href={it.url} className="sig-chip">
              {it.name}
              {it.url && <LinkIcon />}
            </MaybeLink>
          ))}
        </div>
      )
    case 'languages':
      return (
        <div className="sig-chips sig-chips-sm" data-block="" data-compact-if-needed="">
          {visibleItems(section).map((it) => (
            <span key={it.id} className="sig-chip">
              <strong>{it.name}</strong>
              {it.level && <>&nbsp;({it.level})</>}
            </span>
          ))}
        </div>
      )
  }
}
