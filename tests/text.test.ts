import { describe, expect, it } from 'vitest'
import { text } from '../worker/ai'

describe('agent and model text', () => {
  it('turns a line break escaped twice into a real one', () => {
    // What an agent sends when it escapes "\n" once too often: a backslash and an n inside the string.
    expect(text('- Built the front end.\\n- Built the API.')).toBe('- Built the front end.\n- Built the API.')
    expect(text('one\\r\\ntwo')).toBe('one\ntwo')
    expect(text('one\ntwo')).toBe('one\ntwo')
  })
})
