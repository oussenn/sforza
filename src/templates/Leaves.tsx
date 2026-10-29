import { Contacts, Sections, type Parts } from './generic'
import { Photo, visibleSections, type TemplateProps } from './shared'

const parts: Parts = {
  p: 'lv',
  entry: 'split',
  companyFirst: true,
  skills: 'grid2',
  languages: 'text',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ title }) => <h2 className="lv-heading">{title}</h2>,
}

/** Leaves: botanical strip on the left, modern sans, split dates. */
export default function Leaves({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  return (
    <div className="lv">
      <div className="lv-strip" aria-hidden="true" />
      <header className="lv-header" data-block="">
        <div className="lv-id">
          <h1 className="lv-name">{personal.name}</h1>
          {personal.headline && <div className="lv-headline">{personal.headline}</div>}
          <Contacts contacts={personal.contacts} className="lv-contacts" />
        </div>
        {style.showPhoto && photo && <Photo src={photo} className="lv-photo" />}
      </header>
      <div className="g-body lv-body">
        <Sections sections={visibleSections(content)} lang={lang} parts={parts} />
      </div>
    </div>
  )
}
