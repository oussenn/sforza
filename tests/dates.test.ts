import { describe, expect, it } from 'vitest'
import { dateRange, displayDate } from '@/templates/shared'

describe('dates print as MM/YYYY', () => {
  it('turns stored year/month into month/year', () => {
    expect(displayDate('2025/10')).toBe('10/2025')
    expect(displayDate('2024-6')).toBe('06/2024')
  })

  it('keeps free text as written', () => {
    expect(displayDate('Expected 2028')).toBe('Expected 2028')
    expect(displayDate('2026')).toBe('2026')
  })

  it('formats a range and the current flag', () => {
    expect(dateRange({ start: '2025/10', end: '2026/09' }, 'en')).toBe('10/2025 – 09/2026')
    expect(dateRange({ start: '2026/10', end: 'Expected 2028' }, 'en')).toBe('10/2026 – Expected 2028')
  })
})
