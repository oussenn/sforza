import { InlineText, RichText } from '@/lib/markdown'
import { LABELS } from '@shared/templates'
import type { Lang, Section } from '@shared/types'
import { Contacts } from './generic'
import { LinkedText, Photo, sectionTitle, splitSidebar, visibleItems, visibleSections, type TemplateProps } from './shared'

/**
 * Scholar: navy serif. A round photo beside a centred header (name in capitals, italic headline, contacts), then
 * a narrow column (education, languages, skills) and the main column (profile, experience, projects, awards)
 * on either side of a thin rule. Headings are navy capitals over a rule; dates are written out ("Mar 2026").
 */
export default function Scholar({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  const sections = splitSidebar(visibleSections(content))
  return (
    <div className="sch">
      <header className="sch-header" data-block="">
        {style.showPhoto && photo && <Photo src={photo} className="sch-photo" />}
        <div className="sch-id">
          <h1 className="sch-name">{personal.name}</h1>
          {personal.headline && <div className="sch-headline">{personal.headline}</div>}
          <Contacts contacts={personal.contacts} className="sch-contacts" icons={style.showIcons} />
        </div>
      </header>
      <div className="sch-cols">
        <aside className="sch-side" data-col="side">
          {sections.side.map((section) => (
            <SchSection key={section.id} section={section} lang={lang} narrow />
          ))}
        </aside>
        <main className="sch-main" data-col="main">
          {sections.main.map((section) => (
            <SchSection key={section.id} section={section} lang={lang} narrow={false} />
          ))}
        </main>
      </div>
    </div>
  )
}

/** "2026/03" prints as "Mar 2026" in the CV's language; anything else ("Expected 2028") as written. */
function monthYear(value: string | undefined, lang: Lang): string {
  const v = (value ?? '').trim()
  const m = v.match(/^(\d{4})[/-](\d{1,2})$/)
  if (!m) return v
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15))
  return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date).replace('.', '')
}

function dates(item: { start?: string; end?: string; current?: boolean }, lang: Lang): string {
  const start = monthYear(item.start, lang)
  const end = item.current ? LABELS[lang].present : monthYear(item.end, lang)
  return start && end ? `${start} – ${end}` : start || end
}

const joined = (...parts: (string | undefined)[]) => parts.filter((p) => p?.trim()).join(' · ')

function SchSection({ section, lang, narrow }: { section: Section; lang: Lang; narrow: boolean }) {
  const showTitle = section.type !== 'summary' || section.showTitle !== false
  return (
    <section className={`sch-section sch-sec-${section.type}`}>
      {showTitle && (
        <h2 className="sch-heading" data-block="" data-keep="" data-heading="">
          {sectionTitle(section, lang)}
        </h2>
      )}
      <SchBody section={section} lang={lang} narrow={narrow} />
    </section>
  )
}

/**
 * Bold title with the dates on the right (main column) or on a line of their own (narrow column), the italic
 * second line below it, then the description.
 */
function Entry(props: { title: string; url?: string; sub?: string; date: string; description?: string; narrow: boolean }) {
  const { title, url, sub, date, description, narrow } = props
  const hasDesc = !!description?.trim()
  return (
    <div className="sch-entry" data-entry="">
      <div className="sch-head" data-block="" {...(hasDesc ? { 'data-keep': '' } : {})}>
        <div className="sch-row">
          <span className="sch-title">
            <LinkedText text={title} href={url} />
          </span>
          {!narrow && date && <span className="sch-date">{date}</span>}
        </div>
        {sub && <div className="sch-sub">{sub}</div>}
        {narrow && date && <div className="sch-when">{date}</div>}
      </div>
      {hasDesc && <RichText text={description!} className="sch-desc" />}
    </div>
  )
}

function SchBody({ section, lang, narrow }: { section: Section; lang: Lang; narrow: boolean }) {
  switch (section.type) {
    case 'summary':
      return <RichText text={section.text} className="sch-summary" />
    case 'experience':
      return (
        <div className="sch-entries">
          {visibleItems(section).map((it) => (
            <Entry key={it.id} title={it.position} url={it.url} sub={joined(it.company, it.location)} date={dates(it, lang)} description={it.description} narrow={narrow} />
          ))}
        </div>
      )
    case 'education':
      return (
        <div className="sch-entries">
          {visibleItems(section).map((it) => (
            <Entry key={it.id} title={it.degree} url={it.url} sub={joined(it.school, it.location)} date={dates(it, lang)} description={it.description} narrow={narrow} />
          ))}
        </div>
      )
    case 'projects':
      return (
        <div className="sch-entries">
          {visibleItems(section).map((it) => (
            <Entry key={it.id} title={it.name} url={it.url} sub={it.subtitle} date={dates(it, lang)} description={it.description} narrow={narrow} />
          ))}
        </div>
      )
    case 'custom':
      // Awards read as one bullet each: "Title (2024): what it was for".
      return (
        <ul className="sch-awards">
          {visibleItems(section).map((it) => {
            const when = dates(it, lang)
            const text = joined(it.subtitle, it.location)
            const desc = it.description.replace(/^\s*-\s+/gm, '').replace(/\s*\n\s*/g, ' ').trim()
            return (
              <li key={it.id} className="sch-award" data-block="">
                <strong>
                  <LinkedText text={when ? `${it.title} (${when})` : it.title} href={it.url} />
                </strong>
                {text && `, ${text}`}
                {desc && (
                  <>
                    {': '}
                    <InlineText text={desc} />
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )
    case 'certifications':
      return (
        <div className="sch-lines">
          {visibleItems(section).map((it) => (
            <div key={it.id} className="sch-row" data-block="">
              <span>
                <strong>
                  <LinkedText text={it.name} href={it.url} />
                </strong>
                {it.issuer && <em>, {it.issuer}</em>}
              </span>
              {it.date && <span className="sch-date">{it.date}</span>}
            </div>
          ))}
        </div>
      )
    case 'skills':
      return (
        <div className="sch-lines">
          {visibleItems(section).map((it) => (
            <div key={it.id} data-block="">
              {it.name && <strong className="sch-skill">{it.name}: </strong>}
              {it.details && <InlineText text={it.details} />}
            </div>
          ))}
        </div>
      )
    case 'languages':
      return (
        <div className="sch-langs">
          {visibleItems(section).map((it) => (
            <div key={it.id} className="sch-row" data-block="">
              <strong>{it.name}</strong>
              {it.level && <em className="sch-date">{it.level}</em>}
            </div>
          ))}
        </div>
      )
  }
}
