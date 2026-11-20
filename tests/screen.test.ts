import { describe, expect, it } from 'vitest'
import { cityOf, cleanSearchProfile } from '../shared/utils'
import type { SearchProfile } from '../shared/types'
import { linkedInAgeDays, matchesKeywords, parseLinkedInCards, parseStellenwerk, parseStepStone, slug, type Listing } from '../worker/boards'
import { firstPlace, germanAsked, inFields, profilePlaces, screenPosting } from '../worker/screen'

const EN = 'You will join our team and work with our data. We offer flexible hours and you will learn a lot with us. '
const DE = 'Du unterstützt unser Team und arbeitest mit Daten. Wir bieten dir flexible Arbeitszeiten und die Möglichkeit, mit uns zu wachsen. '

const base = {
  roles: 'Working student roles in data engineering, data analytics and BI, ERP (Odoo, SAP), software engineering, IT consulting.',
  locations: 'Dortmund and the Ruhr area (Bochum, Essen, Duisburg), Düsseldorf; remote within Germany',
  radiusKm: 50,
  jobTypes: ['working_student', 'student_assistant', 'internship'],
  workModes: ['onsite', 'hybrid', 'remote'],
}
// English working language, German only as a plus (the "basic" limit), and German up to C1.
const english = cleanSearchProfile({ ...base, germanLimit: 'basic' }) as SearchProfile
const germanC1 = cleanSearchProfile({ ...base, germanLimit: 'C1' }) as SearchProfile
const today = new Date('2026-11-05T12:00:00Z')

// The cases that went wrong in the November runs (daily/test_classify.py), with the verdict for each profile.
const CASES: [string, string, string, string | null, string, string][] = [
  ['Working Student Data Analyst', 'Dortmund', 'hashtags are no requirement', EN.repeat(3) + 'Working student, up to 20 hours. Fluent English. #german #werkstudent', 'candidate', 'candidate'],
  ['Working Student Data Engineering', 'Essen', '"Germany" is no German', EN.repeat(3) + 'Working student, 20 hours. Residence in Germany is required. Fluent English.', 'candidate', 'candidate'],
  ['Working Student Data Analyst', 'Düsseldorf', 'a plus in another clause', EN.repeat(3) + 'Working student, 20 hours. Fluent German, French is a plus.', 'drop:German required', 'candidate'],
  ['Working Student Data Quality', 'Essen', 'Muttersprache nicht relevant', EN.repeat(3) + 'Working student, 20 hours. Fluent English; Muttersprache ist nicht relevant.', 'candidate', 'candidate'],
  ['Werkstudent Aktuariat Pricing (m/w/d)', 'Düsseldorf', 'German ad', DE.repeat(3) + 'Werkstudent, bis zu 20 Stunden pro Woche. Python und SQL.', 'drop:German-language ad', 'check'],
  ['Werkstudent Vertriebsanalyse und -steuerung (m/w/d)', 'Düsseldorf', 'gute Deutschkenntnisse', DE.repeat(3) + 'Werkstudent, 20 Stunden. Gute Deutschkenntnisse.', 'drop:German required', 'candidate'],
  ['Data Analyst (m/w/d)', 'Dortmund', 'regular job', EN.repeat(3) + 'Join us as a data analyst with Python and SQL.', 'drop:Not a student', 'drop:Not a student'],
  ['Working Student Data Analyst', 'Köln, North Rhine-Westphalia, Germany', 'far away', EN.repeat(3) + 'Working student, 20 hours. Fluent English.', 'drop:Outside your places', 'drop:Outside your places'],
  ['Werkstudent Datenanalyse (m/w/d)', 'Bochum', 'fließend', DE.repeat(3) + 'Werkstudent, 20 Stunden. Fließende Deutschkenntnisse in Wort und Schrift.', 'drop:German required', 'candidate'],
  ['Working Student Data', 'Hamburg, Germany', 'far, title only', null, 'drop:Outside your places', 'drop:Outside your places'],
  ['Working Student Data Engineering', 'Dortmund', 'and/or English', EN.repeat(3) + 'Working student, 20 hours. Good communication skills in German and/or English.', 'candidate', 'candidate'],
  ['Werkstudent Data Engineering (m/w/d)', 'Herne', 'a Ruhr city the profile does not name', EN.repeat(3) + 'Working student, 20 hours.', 'candidate', 'candidate'],
]

describe('screening a posting against the search profile', () => {
  for (const [title, location, what, text, forEnglish, forGerman] of CASES) {
    it(`${title} in ${location}: ${what}`, () => {
      for (const [profile, want] of [
        [english, forEnglish],
        [germanC1, forGerman],
      ] as const) {
        const s = screenPosting({ title, location, ...(text !== null && { text }) }, profile, today)
        const [verdict, reason] = want.split(':')
        expect(s.verdict, `${profile.germanLimit}: ${s.reason}`).toBe(verdict)
        if (reason) expect(s.reason).toContain(reason)
      }
    })
  }

  it('drops listings older than 7 days and old LinkedIn ads shown as new', () => {
    expect(screenPosting({ title: 'Working Student Data', location: 'Dortmund', posted_on: '2026-10-20' }, english, today).reason).toContain('more than 7 days')
    expect(screenPosting({ title: 'Working Student Data', location: 'Dortmund', posted_on: '2026-11-04', age_days: 40 }, english, today).reason).toContain('older ad')
    expect(screenPosting({ title: 'Working Student Data', location: 'Dortmund', posted_on: '2026-11-04', age_days: 2 }, english, today).verdict).toBe('candidate')
  })

  it('takes a board’s remote tag alone as a check, the search’s place from the profile and the city from the CV', () => {
    const tagged = screenPosting({ title: 'Working Student Data', location: 'Hamburg, Germany', remote: true }, english, today)
    expect(tagged.verdict).toBe('check')
    expect(tagged.reason).toContain('Listed as remote')
    expect(screenPosting({ title: 'Working Student Data', location: 'Hamburg, Germany' }, english, today).verdict).toBe('drop')
    expect(firstPlace(base.locations)).toBe('Dortmund')
    const cv = (value: string) => ({ personal: { contacts: [{ id: 'c', type: 'location', value, url: '' }] } }) as unknown as Parameters<typeof cityOf>[0]
    expect(cityOf(cv('Neuer Graben 128, 44137 Dortmund, Germany'))).toBe('Dortmund')
    expect(cityOf(cv('Dortmund, Germany'))).toBe('Dortmund')
    expect(cityOf(cv('44137 Dortmund'))).toBe('Dortmund')
  })

  it('reads the German requirement and the places of a profile', () => {
    expect(germanAsked('Sehr gute Deutschkenntnisse in Wort und Schrift').level).toBe('fluent')
    expect(germanAsked('German is a plus').level).toBe('plus')
    expect(germanAsked('We speak English').level).toBe('not mentioned')
    expect(profilePlaces(base.locations)).toEqual(expect.arrayContaining(['dortmund', 'bochum', 'düsseldorf', 'gelsenkirchen']))
    expect(profilePlaces(base.locations)).not.toContain('remote')
    expect(inFields('Werkstudent Datenanalyse (m/w/d)', base.roles)).toBe(true)
    expect(inFields('Werkstudent Marketing (m/w/d)', base.roles)).toBe(false)
  })
})

describe('reading job boards', () => {
  it('parses LinkedIn guest search cards', () => {
    const html =
      '<ul><li><div data-entity-urn="urn:li:jobPosting:4490000001"><h3 class="base-search-card__title"> Working Student Data &amp; BI </h3>' +
      '<h4 class="base-search-card__subtitle"><a href="#">Acme GmbH</a></h4><span class="job-search-card__location">Dortmund, North Rhine-Westphalia, Germany</span>' +
      '<time datetime="2026-11-04">1 day ago</time></div></li></ul>'
    expect(parseLinkedInCards(html)).toEqual([
      { source: 'LinkedIn', id: '4490000001', title: 'Working Student Data & BI', company: 'Acme GmbH', location: 'Dortmund, North Rhine-Westphalia, Germany', posted_on: '2026-11-04', url: 'https://www.linkedin.com/jobs/view/4490000001' },
    ])
  })

  it('parses the listings StepStone embeds in its result page', () => {
    const html = `<script>window.__S = {"other":1,"items":[{"harmonisedId":"x","id":13000001,"title":"Werkstudent Data [m/w/d]","companyName":"Beta AG","location":"Essen","datePosted":"2026-11-03T08:00:00Z","url":"/stellenangebote--Werkstudent-Data-Essen-Beta-AG--13000001-inline.html?rltr=1"}],"more":"]"};</script>`
    expect(parseStepStone(html, true)).toEqual([
      { source: 'StepStone', id: '13000001', title: 'Werkstudent Data [m/w/d]', company: 'Beta AG', location: 'Essen', posted_on: '2026-11-03', url: 'https://www.stepstone.de/stellenangebote--Werkstudent-Data-Essen-Beta-AG--13000001-inline.html', english: true },
    ])
    expect(slug('Werkstudent Datenanalyse Düsseldorf')).toBe('werkstudent-datenanalyse-duesseldorf')
  })

  it('parses Stellenwerk cards, with the date from the link', () => {
    const html =
      '<a href="/dortmund/werkstudent-mwd-marketing-261120-280372" target="_blank" class="flex flex-col "><div><img src="x.png" alt="Firmenlogo"></div>' +
      '<p class="text-lg font-bold ">Werkstudent (m/w/d) Marketing</p> <div><button><svg viewBox="0 0 24 24"><path d="M1"></path></svg></button></div>' +
      '<p>Stadtwerke Herne AG<span class="mx-1">·</span>Herne, Nordrhein-Westfalen, Deutschland</p><span>Studierendenjob </span><span>Vor Ort</span><p> vor 5 Stunden </p></a>'
    // A private ad has no company line; "Homeoffice möglich" is not remote.
    const priv = '<a href="/dortmund/nachhilfe-mathe-261119-280300" class="x"><p>Nachhilfe Mathematik</p><span>Privatanzeige</span><p>vor 1 Tag</p></a>'
    expect(parseStellenwerk(priv, 'dortmund')[0]).toMatchObject({ title: 'Nachhilfe Mathematik', company: '', location: '', hours: 'Privatanzeige' })
    const hybrid = html.replace('Vor Ort', 'Homeoffice möglich')
    expect(parseStellenwerk(hybrid, 'dortmund')[0].remote).toBeUndefined()
    expect(parseStellenwerk(html, 'dortmund')).toEqual([
      {
        source: 'Stellenwerk',
        id: '280372',
        title: 'Werkstudent (m/w/d) Marketing',
        company: 'Stadtwerke Herne AG',
        location: 'Herne, Nordrhein-Westfalen, Deutschland',
        posted_on: '2026-11-20',
        url: 'https://www.stellenwerk.de/dortmund/werkstudent-mwd-marketing-261120-280372',
        hours: 'Studierendenjob',
      },
    ])
  })

  it('tells an old LinkedIn ad by its id, and matches keyword phrases word by word', () => {
    const l = (id: number): Listing => ({ source: 'LinkedIn', id: String(id), title: '', company: '', location: '', posted_on: '', url: '' })
    const all = [4490700000, 4490600000, 4490500000, 4490400000, 4480000000].map(l)
    expect(linkedInAgeDays(all[0], all)).toBe(0)
    expect(linkedInAgeDays(all[4], all)).toBeGreaterThan(25)
    const ad: Listing = { ...l(1), source: 'Arbeitnow', title: 'Working Student (m/f/d) Data Platform', text: 'We build pipelines.' }
    expect(matchesKeywords(ad, ['working student data'])).toBe(true)
    expect(matchesKeywords(ad, ['werkstudent marketing'])).toBe(false)
  })
})
