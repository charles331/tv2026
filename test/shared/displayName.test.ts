import { describe, it, expect } from 'vitest'
import { displayName } from '../../src/shared/displayName'

describe('displayName', () => {
  it('hides the French language prefix the provider puts on titles', () => {
    expect(displayName('FR - L’Éléphant bleu (2024)')).toBe('L’Éléphant bleu (2024)')
    expect(displayName('FR -Dune')).toBe('Dune')
    expect(displayName('FR- Dune')).toBe('Dune')
    expect(displayName('Fr - Dune')).toBe('Dune')
    expect(displayName('|FR| TF1 UHD')).toBe('TF1 UHD')
    expect(displayName('|FR|  France 2')).toBe('France 2')
    expect(displayName('FR | M6 HD')).toBe('M6 HD')
    expect(displayName('FR| Arte')).toBe('Arte')
    expect(displayName('|FR| FILMS ACTION')).toBe('FILMS ACTION')
    expect(displayName('[FR] CHEVAL TV HD')).toBe('CHEVAL TV HD')
    expect(displayName('FR. - Les Enfants du temps (2019)')).toBe('Les Enfants du temps (2019)')
  })
  it('keeps the other language prefixes: they tell what is not French', () => {
    expect(displayName('|US| CNN')).toBe('|US| CNN')
    expect(displayName('AF - Film')).toBe('AF - Film')
    expect(displayName('|BE| La Une')).toBe('|BE| La Une')
  })
  it('does not touch titles that merely start with FR', () => {
    expect(displayName('France 2')).toBe('France 2')
    expect(displayName('Frozen (2013)')).toBe('Frozen (2013)')
    expect(displayName('FRANCE 24')).toBe('FRANCE 24')
  })
  it('keeps the raw name when nothing would be left', () => {
    expect(displayName('FR - ')).toBe('FR - ')
    expect(displayName('')).toBe('')
  })
})
