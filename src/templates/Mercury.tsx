import { Contacts, Sections, type Parts } from './generic'
import { Photo, visibleSections, type TemplateProps } from './shared'

const parts: Parts = {
  p: 'mf',
  entry: 'rail',
  skills: 'grid3',
  languages: 'dots',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ title }) => <h2 className="mf-heading">{title}</h2>,
}

/** Mercury Flow: grey header band, centred headings, dates in a side rail. */
export default function Mercury({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  return (
    <div className="mf">
      <header className="mf-header" data-block="">
        {style.showPhoto && photo && <Photo src={photo} className="mf-photo" />}
        <div className="mf-id">
          <h1 className="mf-name">{personal.name}</h1>
          {personal.headline && <div className="mf-headline">{personal.headline}</div>}
          <Contacts contacts={personal.contacts} className="mf-contacts" />
        </div>
      </header>
      <div className="g-body mf-body">
        <Sections sections={visibleSections(content)} lang={lang} parts={parts} />
      </div>
    </div>
  )
}
