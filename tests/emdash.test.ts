import { describe, expect, it } from 'vitest'
import { noEmDash } from '../shared/utils'

describe('documents without em dashes', () => {
  it('turns an em dash between words or clauses into a comma', () => {
    expect(noEmDash('I clean data — and I check it.')).toBe('I clean data, and I check it.')
    expect(noEmDash('Python—SQL—Power BI')).toBe('Python, SQL, Power BI')
    expect(noEmDash('Datenqualität ― mein Thema')).toBe('Datenqualität, mein Thema')
  })

  it('keeps a range as an en dash and a leading one as a bullet', () => {
    expect(noEmDash('2019—2022')).toBe('2019–2022')
    expect(noEmDash('— first point\n  — second point')).toBe('- first point\n  - second point')
  })

  it('leaves no stray comma before punctuation or at a line end', () => {
    expect(noEmDash('A strong result —.')).toBe('A strong result.')
    expect(noEmDash('Result —\nNext line')).toBe('Result\nNext line')
    expect(noEmDash('one — , two')).toBe('one, two')
  })

  it('changes nothing else', () => {
    const text = 'Working Student – Data (2023 – 2026); see github.com/x-y'
    expect(noEmDash(text)).toBe(text)
  })
})
