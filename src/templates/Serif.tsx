import { Contacts, Sections, type Parts } from './generic'
import { Photo, visibleSections, type TemplateProps } from './shared'

const parts: Parts = {
  p: 'cs',
  entry: 'split',
  skills: 'list',
  languages: 'dots',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ title }) => <h2 className="cs-heading">{title}</h2>,
}

/** Classic Serif: centred header, ruled uppercase headings, right-aligned dates. */
export default function Serif({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  return (
    <div className="cs">
      <header className="cs-header" data-block="">
        {style.showPhoto && photo && <Photo src={photo} className="cs-photo" />}
        <h1 className="cs-name">{personal.name}</h1>
        {personal.headline && <div className="cs-headline">{personal.headline}</div>}
        <Contacts contacts={personal.contacts} className="cs-contacts" icons={style.showIcons} />
      </header>
      <div className="g-body cs-body">
        <Sections sections={visibleSections(content)} lang={lang} parts={parts} />
      </div>
    </div>
  )
}
