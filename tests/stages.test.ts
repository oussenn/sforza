import { describe, expect, it } from 'vitest'
import type { Board, BoardColumn } from '@shared/types'
import { baseStage, boardStages, cleanBoard, cleanBoardColumns, isSentStage, isStage, isUnsent, newColumnId, placeStage, stageLabel } from '@shared/utils'

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

describe('a board that hides a built-in column', () => {
  const english: BoardColumn = { id: 'col_draft_enen11', label: 'Drafts 🇬🇧', lang: 'en' }
  const german: BoardColumn = { id: 'col_draft_dede22', label: 'Drafts 🇩🇪', lang: 'de' }
  const board: Board = { columns: [english, german, screen], hidden: ['draft'] }

  it('reads the old plain list of columns as a board that hides nothing', () => {
    expect(cleanBoard([screen])).toEqual({ columns: [screen], hidden: [] })
    expect(cleanBoard(null)).toEqual({ columns: [], hidden: [] })
  })

  it('hides a stage only while a column of its own follows it', () => {
    expect(cleanBoard({ columns: [english, german], hidden: ['draft', 'saved', 'nope'] })).toEqual({ columns: [english, german], hidden: ['draft'] })
    expect(cleanBoard({ columns: [screen], hidden: ['draft'] }).hidden).toEqual([])
  })

  it('keeps a language only on columns after Draft', () => {
    expect(cleanBoardColumns([{ ...screen, lang: 'de' }, german])).toEqual([screen, german])
    expect(cleanBoardColumns([{ ...german, lang: 'xx' }])).toEqual([{ id: german.id, label: german.label }])
  })

  it('leaves the hidden stage out of the board', () => {
    expect(boardStages(board.columns, board.hidden)).toEqual(['saved', english.id, german.id, 'applied', screen.id, 'interview', 'offer', 'rejected'])
  })

  it('puts a draft in the column of its language', () => {
    expect(placeStage('draft', 'de', board)).toBe(german.id)
    expect(placeStage('draft', 'en', board)).toBe(english.id)
    // No column for French, or no language yet: the first one.
    expect(placeStage('draft', 'fr', board)).toBe(english.id)
    expect(placeStage('draft', null, board)).toBe(english.id)
    // A draft whose language changed moves to its own column.
    expect(placeStage(english.id, 'de', board)).toBe(german.id)
    expect(placeStage(german.id, 'de', board)).toBe(german.id)
  })

  it('changes nothing on a board that hides nothing', () => {
    const plain: Board = { columns: [english, german], hidden: [] }
    expect(placeStage('draft', 'de', plain)).toBe('draft')
    expect(placeStage(english.id, 'de', plain)).toBe(english.id)
    expect(placeStage('applied', 'de', board)).toBe('applied')
  })
})
