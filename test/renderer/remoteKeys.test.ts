import { describe, it, expect } from 'vitest'
import { keyToAction, isTextField } from '../../src/renderer/src/lib/remote/keys'

describe('keyToAction', () => {
  const out = { inTextField: false }
  const inField = { inTextField: true }
  it('maps arrows, Enter and keypad Enter', () => {
    expect(keyToAction({ key: 'ArrowUp' }, out)).toBe('up')
    expect(keyToAction({ key: 'ArrowDown' }, out)).toBe('down')
    expect(keyToAction({ key: 'ArrowLeft' }, out)).toBe('left')
    expect(keyToAction({ key: 'ArrowRight' }, out)).toBe('right')
    expect(keyToAction({ key: 'Enter' }, out)).toBe('ok')
  })
  it('maps every back key', () => {
    expect(keyToAction({ key: 'Escape' }, out)).toBe('back')
    expect(keyToAction({ key: 'Backspace' }, out)).toBe('back')
    expect(keyToAction({ key: 'BrowserBack' }, out)).toBe('back')
    expect(keyToAction({ key: 'Unidentified', keyCode: 166 }, out)).toBe('back')
  })
  it('leaves text editing keys to a text field', () => {
    expect(keyToAction({ key: 'Backspace' }, inField)).toBeNull()
    expect(keyToAction({ key: 'ArrowLeft' }, inField)).toBeNull()
    expect(keyToAction({ key: 'ArrowRight' }, inField)).toBeNull()
  })
  it('still leaves a text field with up/down, Escape and Enter', () => {
    expect(keyToAction({ key: 'ArrowDown' }, inField)).toBe('down')
    expect(keyToAction({ key: 'ArrowUp' }, inField)).toBe('up')
    expect(keyToAction({ key: 'Escape' }, inField)).toBe('back')
    expect(keyToAction({ key: 'Enter' }, inField)).toBe('ok')
  })
  it('ignores other keys', () => {
    expect(keyToAction({ key: 'a' }, out)).toBeNull()
    expect(keyToAction({ key: 'Tab' }, out)).toBeNull()
  })
})

describe('isTextField', () => {
  const el = (tagName: string, type?: string, isContentEditable = false): Element =>
    ({ tagName, type, isContentEditable }) as unknown as Element
  it('recognises editable text controls', () => {
    expect(isTextField(el('INPUT', 'text'))).toBe(true)
    expect(isTextField(el('INPUT', 'search'))).toBe(true)
    expect(isTextField(el('INPUT', 'password'))).toBe(true)
    expect(isTextField(el('INPUT', 'number'))).toBe(true)
    expect(isTextField(el('TEXTAREA'))).toBe(true)
    expect(isTextField(el('DIV', undefined, true))).toBe(true)
  })
  it('rejects other elements', () => {
    expect(isTextField(el('INPUT', 'checkbox'))).toBe(false)
    expect(isTextField(el('BUTTON'))).toBe(false)
    expect(isTextField(null)).toBe(false)
  })
})
