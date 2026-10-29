import { Contacts, Sections, type Parts } from './generic'
import { Photo, SectionIcon, splitSidebar, visibleSections, type TemplateProps } from './shared'

const side: Parts = {
  p: 'abs',
  entry: 'stacked',
  skills: 'list',
  languages: 'dots',
  certs: 'list',
  summaryTitle: true,
  Heading: ({ section, title }) => (
    <h2 className="abs-heading">
      <SectionIcon type={section.type} className="abs-heading-icon" />
      <span>{title}</span>
    </h2>
  ),
}

const main: Parts = {
  p: 'abm',
  entry: 'stacked',
  skills: 'grid2',
  languages: 'grid',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ section, title }) => (
    <h2 className="abm-heading">
      <span className="abm-heading-icon">
        <SectionIcon type={section.type} />
      </span>
      <span>{title}</span>
    </h2>
  ),
}

/** Atlantic Blue: dark sidebar with identity, contact and short sections. */
export default function Atlantic({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  const sections = splitSidebar(visibleSections(content))
  return (
    <div className="ab">
      <aside className="ab-side" data-col="side">
        <div className="ab-id" data-block="">
          {style.showPhoto && photo && <Photo src={photo} className="ab-photo" />}
          <h1 className="ab-name">{personal.name}</h1>
          {personal.headline && <div className="ab-headline">{personal.headline}</div>}
        </div>
        <div data-block="">
          <Contacts contacts={personal.contacts} className="ab-contacts" />
        </div>
        <div className="g-body abs-body">
          <Sections sections={sections.side} lang={lang} parts={side} />
        </div>
      </aside>
      <main className="ab-main g-body" data-col="main">
        <Sections sections={sections.main} lang={lang} parts={main} />
      </main>
    </div>
  )
}
