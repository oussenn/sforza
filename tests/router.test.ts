// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseRoute, routePath } from '@/editor/router'

describe('editor addresses', () => {
  it('opens the board at / and at any unknown address', () => {
    expect(parseRoute('/')).toEqual({ page: 'applications', appId: null })
    expect(parseRoute('/nope')).toEqual({ page: 'applications', appId: null })
    expect(routePath({ page: 'applications', appId: null })).toBe('/applications')
  })

  it('gives every page a short address that reads back the same', () => {
    const routes = [
      { page: 'cvs' },
      { page: 'mcp' },
      { page: 'jobsearch' },
      { page: 'knowledge' },
      { page: 'applications', appId: 'app_1' },
      { page: 'letters', appId: null },
      { page: 'cv', id: 'cv_1', tab: 'customize' },
    ] as const
    for (const route of routes) expect(parseRoute(routePath(route))).toEqual(route)
    expect(routePath({ page: 'mcp' })).toBe('/connector')
    expect(routePath({ page: 'cv', id: 'cv_1', tab: 'content' })).toBe('/cv/cv_1')
  })

  it('still opens the old /edit addresses', () => {
    expect(parseRoute('/edit')).toEqual({ page: 'applications', appId: null })
    expect(parseRoute('/edit/applications/app_1')).toEqual({ page: 'applications', appId: 'app_1' })
    expect(parseRoute('/edit/cv/cv_1/ai')).toEqual({ page: 'cv', id: 'cv_1', tab: 'ai' })
  })
})
