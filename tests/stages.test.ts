import { describe, expect, it } from 'vitest'
import type { BoardColumn } from '@shared/types'
import { baseStage, boardStages, cleanBoardColumns, isSentStage, isStage, isUnsent, newColumnId, stageLabel } from '@shared/utils'

const screen: BoardColumn = { id: 'col_applied_abc123', label: 'Phone screen' }
const shortlist: BoardColumn = { id: 'col_saved_xyz789', label: 'Shortlist' }

describe('board columns', () => {
  it('places each column right after the stage in its id', () => {
    expect(boardStages([screen, shortlist])).toEqual(['saved', 'col_saved_xyz789', 'draft', 'applied', 'col_applied_abc123', 'interview', 'offer', 'rejected'])
  })

  it('counts a column as the stage it follows', () => {
    expect(baseStage(screen.id)).toBe('applied')
    expect(isSentStage(screen.id)).toBe(true)
    expect(isUnsent(shortlist.id)).toBe(true)
    expect(isUnsent('interview')).toBe(false)
  })

  it('labels columns, and falls back to the stage of a removed one', () => {
    expect(stageLabel(screen.id, [screen])).toBe('Phone screen')
    expect(stageLabel(screen.id, [])).toBe('Applied')
    expect(stageLabel('offer')).toBe('Offer')
  })

  it('accepts only well-formed stage ids', () => {
    expect(isStage('draft')).toBe(true)
    expect(isStage(newColumnId('interview'))).toBe(true)
    expect(isStage('col_unknown_abc123')).toBe(false)
    expect(isStage('col_applied_')).toBe(false)
    expect(isStage(42)).toBe(false)
  })

  it('cleans untrusted columns', () => {
    const cleaned = cleanBoardColumns([screen, { ...screen }, { id: 'bad', label: 'x' }, { id: 'col_offer_aaaa11', label: '   ' }, { id: 'col_draft_bbbb22', label: ' Review ' }])
    expect(cleaned).toEqual([screen, { id: 'col_draft_bbbb22', label: 'Review' }])
    expect(cleanBoardColumns('nope')).toEqual([])
  })
})
