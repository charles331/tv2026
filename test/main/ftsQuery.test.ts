import { describe, it, expect } from 'vitest'
import { toFtsQuery } from '../../src/main/store/ftsQuery'

describe('toFtsQuery', () => {
  it('turns words into prefix terms that must all match', () => {
    expect(toFtsQuery('brugge anderlecht')).toBe('"brugge"* "anderlecht"*')
  })
  it('drops FTS syntax and punctuation (no injection of operators)', () => {
    expect(toFtsQuery('PSG - OM "final" (NEAR) *')).toBe('"psg"* "om"* "final"* "near"*')
    expect(toFtsQuery('l\'Équipe: Real-Madrid')).toBe('"l"* "équipe"* "real"* "madrid"*')
  })
  it('returns null when nothing searchable remains', () => {
    expect(toFtsQuery('  - * ')).toBeNull()
    expect(toFtsQuery('')).toBeNull()
  })
})
