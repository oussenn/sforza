import { describe, expect, it } from 'vitest'
import type { Resume } from '@shared/types'
import { enclosureLines, letterFileName, letterLayoutOf, pdfFileName } from '@shared/utils'

const resume = (name: string, jobTitle?: string) =>
  ({
    sourceLang: 'en',
    content: { en: { personal: { name } } },
    job: jobTitle ? { title: jobTitle } : undefined,
  }) as unknown as Pick<Resume, 'content' | 'sourceLang' | 'job'>

describe('PDF file names: "1. " first, no job title, no language', () => {
  it('names a tailored CV like the master', () => {
    expect(pdfFileName(resume('Jane Doe', 'Working Student - Data Engineer'), 'en')).toBe('1. Jane_Doe_Resume')
    expect(pdfFileName(resume('Jane Doe'), 'en')).toBe('1. Jane_Doe_Resume')
  })

  it('works for the second account and strips accents', () => {
    expect(pdfFileName(resume('Jamie Rivera'), 'en')).toBe('1. Jamie_Rivera_Resume')
    expect(pdfFileName(resume('José Núñez'), 'en')).toBe('1. Jose_Nunez_Resume')
  })

  it('names letters per language', () => {
    expect(letterFileName('Jane Doe', 'en')).toBe('1. Jane_Doe_Cover_Letter')
    expect(letterFileName('Jane Doe', 'de')).toBe('1. Jane_Doe_Anschreiben')
    expect(letterFileName('Jane Doe', 'fr')).toBe('1. Jane_Doe_Lettre_de_motivation')
  })
})

describe('letters', () => {
  it('uses DIN 5008 for German letters unless chosen otherwise', () => {
    expect(letterLayoutOf({}, 'de')).toBe('din5008')
    expect(letterLayoutOf({}, 'en')).toBe('modern')
    expect(letterLayoutOf({ layout: 'modern' }, 'de')).toBe('modern')
  })

  it('splits enclosures on commas and lines', () => {
    expect(enclosureLines('Lebenslauf, Zeugnisse\nImmatrikulationsbescheinigung')).toEqual(['Lebenslauf', 'Zeugnisse', 'Immatrikulationsbescheinigung'])
    expect(enclosureLines(undefined)).toEqual([])
  })
})
