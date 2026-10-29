import { describe, expect, it } from 'vitest'
import { fullNameSalutation, gapSentences, letterIssues } from '../worker/letter'

describe('gapSentences: letters and form answers never point out a missing skill', () => {
  it.each([
    'I have not worked with Looker or Tableau yet.',
    'No Looker or Tableau yet.',
    "I haven't used Snowflake.",
    'I have no hands-on experience with SAP.',
    'I am not yet familiar with dbt.',
    'Ich habe noch keine Erfahrung mit SAP.',
    'Mit Tableau habe ich bisher keine Projekte umgesetzt.',
    "Je n'ai pas encore utilisé Tableau.",
    "Je n'ai aucune expérience avec SAP.",
  ])('flags "%s"', (sentence) => {
    expect(gapSentences(sentence)).toEqual([sentence])
  })

  it.each([
    'I built a Power BI dashboard on Salesforce pipeline data.',
    'Since April 2026 I have been working as a data analyst for a client.',
    'Most of the work was mapping fields, cleaning values and validating the import.',
    'Die Migration ist noch nicht abgeschlossen.',
    'I would welcome the chance to discuss the role.',
  ])('leaves "%s" alone', (sentence) => {
    expect(gapSentences(sentence)).toEqual([])
  })

  it('returns only the offending sentence of a paragraph', () => {
    const text = 'Python and SQL are the tools I use most. I have not worked with Looker yet. I build reports with Power BI.'
    expect(gapSentences(text)).toEqual(['I have not worked with Looker yet.'])
  })
})

describe('letterIssues: numbers and tools must come from the material or the posting', () => {
  const corpus = 'cleaned crm data (salesforce → hubspot), more than 80k+ records, using python and sql. 312 reversible corrections.'
  const posting = 'We use SQL and Python. Tableau is a plus.'
  const letter = (body: string) => ({ subject: 'Application', recipient: 'Acme\nBerlin', body })

  it('accepts facts from the material and the posting', () => {
    expect(letterIssues(letter('I made 312 reversible corrections with Python and SQL, and I know your Tableau setup.'), corpus, posting)).toEqual([])
  })

  it('flags a number that is nowhere in the material', () => {
    expect(letterIssues(letter('I cleaned 9,999 records.'), corpus, posting)).toContain('9999') // numbers are compared without separators
  })

  it('flags a tool the candidate never mentioned', () => {
    expect(letterIssues(letter('I built pipelines in Snowflake.'), corpus, posting)).toContain('snowflake')
  })

  it('reads a possessive as the name itself', () => {
    expect(letterIssues(letter("I would like to join METRO's team and CUBiMed.RUB’s service."), corpus, 'METRO AG, CUBiMed.RUB')).toEqual([])
  })

  it('ignores years', () => {
    expect(letterIssues(letter('I started my master in 2026.'), corpus, posting)).toEqual([])
  })
})

describe('fullNameSalutation', () => {
  it('flags a salutation with the full name', () => {
    expect(fullNameSalutation('Dear Tanja Stricker,\n\nText')).toBe('Dear Tanja Stricker,')
    expect(fullNameSalutation('Sehr geehrte Tanja Stricker,\n\nText')).toBe('Sehr geehrte Tanja Stricker,')
  })
  it('accepts title and surname or the generic salutation', () => {
    expect(fullNameSalutation('Dear Ms Stricker,\n\nText')).toBeNull()
    expect(fullNameSalutation('Sehr geehrte Frau Stricker,\n\nText')).toBeNull()
    expect(fullNameSalutation('Dear Hiring Team,\n\nText')).toBeNull()
    expect(fullNameSalutation('Sehr geehrte Damen und Herren,\n\nText')).toBeNull()
  })
})
