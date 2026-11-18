import { describe, it, expect } from 'vitest'
import { typedSearchChar } from '../../src/renderer/src/lib/remote/typing'

describe('typedSearchChar', () => {
  const out = { inTextField: false }
  it('returns a letter or digit typed outside a text field', () => {
    expect(typedSearchChar({ key: 'a' }, out)).toBe('a')
    expect(typedSearchChar({ key: 'É' }, out)).toBe('É')
    expect(typedSearchChar({ key: '7' }, out)).toBe('7')
  })
  it('ignores typing inside a text field', () => {
    expect(typedSearchChar({ key: 'a' }, { inTextField: true })).toBeNull()
  })
  it('ignores shortcuts and non-character keys', () => {
    expect(typedSearchChar({ key: 'k', ctrlKey: true }, out)).toBeNull()
    expect(typedSearchChar({ key: 'f', altKey: true }, out)).toBeNull()
    expect(typedSearchChar({ key: 'f', metaKey: true }, out)).toBeNull()
    expect(typedSearchChar({ key: 'Enter' }, out)).toBeNull()
    expect(typedSearchChar({ key: ' ' }, out)).toBeNull()
    expect(typedSearchChar({ key: '-' }, out)).toBeNull()
  })
})
