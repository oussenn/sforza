// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isSidebarShortcut, toggleSidebar } from '@/editor/sidebar'

const press = (key: string, code: string, mods: Partial<Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {}) =>
  new KeyboardEvent('keydown', { key, code, ...mods })

describe('the list of My CVs and My Cover Letters', () => {
  it('takes Ctrl+B and ⌘B', () => {
    expect(isSidebarShortcut(press('b', 'KeyB', { ctrlKey: true }))).toBe(true)
    expect(isSidebarShortcut(press('b', 'KeyB', { metaKey: true }))).toBe(true)
    // Caps Lock on
    expect(isSidebarShortcut(press('B', 'KeyB', { ctrlKey: true }))).toBe(true)
  })

  it('leaves other keys and other modifiers alone', () => {
    expect(isSidebarShortcut(press('b', 'KeyB'))).toBe(false)
    expect(isSidebarShortcut(press('B', 'KeyB', { ctrlKey: true, shiftKey: true }))).toBe(false)
    // AltGr is Ctrl+Alt on Windows
    expect(isSidebarShortcut(press('b', 'KeyB', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSidebarShortcut(press('k', 'KeyK', { ctrlKey: true }))).toBe(false)
  })

  it('goes by the letter on Latin keyboards and by the key elsewhere', () => {
    // Dvorak: the key where QWERTY has B types X, so Ctrl+X stays cut
    expect(isSidebarShortcut(press('x', 'KeyB', { ctrlKey: true }))).toBe(false)
    // Dvorak: B sits where QWERTY has N
    expect(isSidebarShortcut(press('b', 'KeyN', { ctrlKey: true }))).toBe(true)
    // Russian and Arabic layouts type no Latin letter on that key
    expect(isSidebarShortcut(press('и', 'KeyB', { ctrlKey: true }))).toBe(true)
    expect(isSidebarShortcut(press('لا', 'KeyB', { ctrlKey: true }))).toBe(true)
  })

  it('remembers the choice in this browser', () => {
    localStorage.removeItem('sidebar')
    toggleSidebar()
    expect(localStorage.getItem('sidebar')).toBe('hidden')
    toggleSidebar()
    expect(localStorage.getItem('sidebar')).toBe('shown')
  })
})
