import { Contacts, Sections, type Parts } from './generic'
import { Photo, visibleSections, type TemplateProps } from './shared'

const parts: Parts = {
  p: 'sf',
  entry: 'split',
  companyFirst: true,
  skills: 'grid3',
  languages: 'grid',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ title }) => <h2 className="sf-heading">{title}</h2>,
}

/** Steady Form: name and role on one line, banded headings, dates on the right. */
export default function Steady({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  return (
    <div className="sf">
      <header className="sf-header" data-block="">
        <div className="sf-id">
          <h1 className="sf-title">
            <span className="sf-name">{personal.name}</span>
            {personal.headline && <span className="sf-headline">{personal.headline}</span>}
          </h1>
          <Contacts contacts={personal.contacts} className={style.showIcons ? 'sf-contacts' : 'sf-contacts sf-plain'} icons={style.showIcons} />
        </div>
        {style.showPhoto && photo && <Photo src={photo} className="sf-photo" />}
      </header>
      <div className="g-body sf-body">
        <Sections sections={visibleSections(content)} lang={lang} parts={parts} />
      </div>
    </div>
  )
}
