import { describe, expect, it } from 'vitest'
import type { ResumeContent } from '@shared/types'
import { orderLanguages } from '@shared/utils'

const withLanguages = (names: string[]) =>
  ({
    sections: [
      {
        id: 's',
        type: 'languages',
        title: '',
        visible: true,
        placement: 'side',
        items: names.map((name, i) => ({ id: `l${i}`, name, level: '', rating: 0 })),
      },
    ],
  }) as unknown as ResumeContent

const names = (c: ResumeContent) => (c.sections[0] as { items: { name: string }[] }).items.map((i) => i.name)

describe('languages print English, German, Arabic, French, Spanish', () => {
  it('orders English CVs', () => {
    expect(names(orderLanguages(withLanguages(['Arabic', 'German', 'Spanish', 'English', 'French'])))).toEqual([
      'English', 'German', 'Arabic', 'French', 'Spanish',
    ])
  })

  it('orders French and German CVs', () => {
    expect(names(orderLanguages(withLanguages(['Arabe', 'Espagnol', 'Anglais', 'Allemand', 'Français'])))).toEqual([
      'Anglais', 'Allemand', 'Arabe', 'Français', 'Espagnol',
    ])
    expect(names(orderLanguages(withLanguages(['Spanisch', 'Arabisch', 'Deutsch', 'Französisch', 'Englisch'])))).toEqual([
      'Englisch', 'Deutsch', 'Arabisch', 'Französisch', 'Spanisch',
    ])
  })

  it('puts other languages last, in their own order', () => {
    expect(names(orderLanguages(withLanguages(['Italian', 'German', 'Dutch', 'English'])))).toEqual([
      'English', 'German', 'Italian', 'Dutch',
    ])
  })
})
