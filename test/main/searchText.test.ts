import { describe, it, expect } from 'vitest'
import { normalizeForSearch, nameSearch } from '../../src/main/store/searchText'

describe('normalizeForSearch', () => {
  it('drops accents and case', () => {
    expect(normalizeForSearch('Éléphant')).toBe('elephant')
    expect(normalizeForSearch('L’ÉTÉ où Ça a commencé')).toBe('l ete ou ca a commence')
  })
  it('expands ligatures', () => {
    expect(normalizeForSearch('Cœur de bœuf, Lætitia')).toBe('coeur de boeuf laetitia')
  })
  it('turns punctuation into single spaces', () => {
    expect(normalizeForSearch('FR - Spider-Man: No Way Home (2021)')).toBe('fr spider man no way home 2021')
  })
  it('accepts null (SQL NULL)', () => {
    expect(normalizeForSearch(null)).toBe('')
  })
})

describe('nameSearch', () => {
  it('builds one LIKE per word, in any order', () => {
    expect(nameSearch('s.name', 'Reloaded  matrix')).toEqual({
      clause: 'search_norm(s.name) LIKE ? AND search_norm(s.name) LIKE ?',
      params: ['%reloaded%', '%matrix%']
    })
  })
  it('normalises the words like the titles', () => {
    expect(nameSearch('name', 'Éléphant')?.params).toEqual(['%elephant%'])
  })
  it('never lets the user inject LIKE wildcards', () => {
    expect(nameSearch('name', '100% _x')?.params).toEqual(['%100%', '%x%'])
  })
  it('returns null when nothing searchable remains', () => {
    expect(nameSearch('name', ' - ! ')).toBeNull()
    expect(nameSearch('name', '')).toBeNull()
  })
  it('caps the number of words', () => {
    expect(nameSearch('name', 'a b c d e f g h i j')?.params).toHaveLength(8)
  })
})
