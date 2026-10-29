import { afterEach, describe, expect, it, vi } from 'vitest'
import { formAnswersField, readApplicationForm } from '../worker/forms'

describe('formAnswersField', () => {
  it('keeps question, answer and note, and drops junk', () => {
    expect(
      formAnswersField([
        { question: ' Why acme? ', answer: 'Because…', note: '' },
        { question: 'Start date', answer: '', note: 'Your choice' },
        { question: '', answer: 'orphan' },
        'not an object',
        null,
      ]),
    ).toEqual([
      { question: 'Why acme?', answer: 'Because…' },
      { question: 'Start date', answer: '', note: 'Your choice' },
    ])
    expect(formAnswersField('nope')).toEqual([])
  })
})

describe('readApplicationForm (Greenhouse)', () => {
  afterEach(() => vi.unstubAllGlobals())

  const greenhouse = {
    questions: [
      { label: 'First Name', required: true, fields: [{ type: 'input_text' }] },
      { label: 'Resume/CV', required: true, fields: [{ type: 'input_file' }, { type: 'textarea' }] },
      { label: 'Why  this role?', required: true, fields: [{ type: 'textarea' }] },
      { label: 'Commute?', required: true, fields: [{ type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
      { label: 'Hidden', required: false, fields: [{ type: 'input_hidden' }] },
    ],
  }

  it('finds the board of a career page with ?gh_jid= and reads the questions', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      if (url.startsWith('https://careers.acme.com')) return new Response('<html>no board token here</html>')
      if (url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/8878864002?questions=true') return Response.json(greenhouse)
      return new Response('not found', { status: 404 })
    })
    const form = await readApplicationForm('https://careers.acme.com/apply/?gh_jid=8878864002&gh_src=x', 'acme')
    expect(form?.ats).toBe('Greenhouse')
    expect(form?.questions).toEqual([
      { question: 'First Name', required: true, type: 'text' },
      { question: 'Resume/CV', required: true, type: 'file (or pasted text)' },
      { question: 'Why this role?', required: true, type: 'long text' },
      { question: 'Commute?', required: true, type: 'single choice', options: ['Yes', 'No'] },
    ])
  })

  it('returns null for a link that is not a Greenhouse form', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    expect(await readApplicationForm('https://jobs.example.com/apply/123', 'Example')).toBeNull()
    expect(await readApplicationForm('not a url', 'Example')).toBeNull()
  })
})
