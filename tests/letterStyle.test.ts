import { describe, expect, it } from 'vitest'
import { TEMPLATE_MAP } from '@shared/templates'
import { cleanLetterStyle, letterStyleOf } from '@shared/utils'

const cv = { ...TEMPLATE_MAP.steady.style, font: 'Source Sans 3', accent: '#348aa7', fontSize: 9 }

describe('letter style', () => {
  it('follows the CV until the user changes something', () => {
    expect(letterStyleOf(cv, undefined, 'modern')).toMatchObject({ font: 'Source Sans 3', accent: '#348aa7', fontSize: 10.5, lineHeight: 1.45 })
    expect(letterStyleOf(cv, { font: 'Lora' }, 'banner')).toMatchObject({ font: 'Lora', accent: '#348aa7' })
  })

  it('keeps DIN 5008 at 11 pt or more, with a blank line between paragraphs', () => {
    expect(letterStyleOf(cv, {}, 'din5008')).toMatchObject({ fontSize: 11, lineHeight: 1.2, paragraphGap: 1 })
    expect(letterStyleOf(cv, { fontSize: 10 }, 'din5008').fontSize).toBe(11)
    expect(letterStyleOf(cv, { fontSize: 10 }, 'classic').fontSize).toBe(10)
  })

  it('keeps only valid fonts, colours and sizes within the limits', () => {
    expect(cleanLetterStyle({ font: 'Comic Sans', headingFont: '', accent: '#1E3A52', text: 'red', fontSize: 30, marginX: 2, junk: 1 })).toEqual({
      headingFont: '',
      accent: '#1e3a52',
      fontSize: 13,
      marginX: 12,
    })
    expect(cleanLetterStyle(null)).toEqual({})
  })
})
