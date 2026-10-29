import { Contacts, Sections, type Parts } from './generic'
import { Photo, visibleSections, type TemplateProps } from './shared'

const parts: Parts = {
  p: 'ex',
  entry: 'rail',
  skills: 'rated',
  languages: 'dots',
  certs: 'grid',
  summaryTitle: true,
  Heading: ({ title }) => <h2 className="ex-heading">{title}</h2>,
}

/** Executive: traditional serif, ruled headings, date rail and rated skills. */
export default function Executive({ content, style, photo, lang }: TemplateProps) {
  const { personal } = content
  return (
    <div className="ex">
      <header className="ex-header" data-block="">
        <div className="ex-id">
          <h1 className="ex-title">
            <span className="ex-name">{personal.name}</span>
            {personal.headline && <span className="ex-headline">{personal.headline}</span>}
          </h1>
          <Contacts contacts={personal.contacts} className="ex-contacts" icons={style.showIcons} />
        </div>
        {style.showPhoto && photo && <Photo src={photo} className="ex-photo" />}
      </header>
      <div className="g-body ex-body">
        <Sections sections={visibleSections(content)} lang={lang} parts={parts} />
      </div>
    </div>
  )
}
