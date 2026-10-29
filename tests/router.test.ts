// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseRoute, routePath } from '@/editor/router'

describe('editor addresses', () => {
  it('opens the MCP panel at /edit/mcp', () => {
    expect(parseRoute('/edit/mcp')).toEqual({ page: 'mcp' })
    expect(routePath({ page: 'mcp' })).toBe('/edit/mcp')
  })

  it('still opens the old addresses', () => {
    expect(parseRoute('/edit/claude')).toEqual({ page: 'mcp' })
    expect(parseRoute('/edit/profile')).toEqual({ page: 'jobsearch' })
  })
})
