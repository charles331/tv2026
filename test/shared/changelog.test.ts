import { describe, it, expect } from 'vitest'
import { CHANGELOG, mergeChangelog } from '../../src/shared/changelog'

describe('CHANGELOG', () => {
  it('is non-empty', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
  })

  it('has well-formed entries', () => {
    for (const entry of CHANGELOG) {
      expect(entry.version, 'version must be a non-empty string').toMatch(/\S/)
      expect(entry.date, `date for v${entry.version} must be ISO YYYY-MM-DD`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      )
      expect(entry.changes.length, `v${entry.version} must list at least one change`).toBeGreaterThan(0)
      for (const change of entry.changes) {
        expect(change).toMatch(/\S/)
      }
    }
  })

  it('has unique version strings', () => {
    const versions = CHANGELOG.map((e) => e.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('is sorted newest first', () => {
    const versions = CHANGELOG.map((e) => e.version)
    const sorted = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      return pb[0]! - pa[0]! || pb[1]! - pa[1]! || pb[2]! - pa[2]!
    })
    expect(versions).toEqual(sorted)
  })

  it('merges generated entries before the history, generated winning on duplicates', () => {
    const merged = mergeChangelog(
      [
        { version: '0.17.0', date: '2026-11-12', changes: ['b'] },
        { version: '0.16.1', date: '2026-11-08', changes: ['generated'] }
      ],
      [
        { version: '0.16.1', date: '2026-11-08', changes: ['history'] },
        { version: '0.9.0', date: '2026-07-01', changes: ['a'] },
        { version: '0.10.0', date: '2026-07-02', changes: ['c'] }
      ]
    )
    expect(merged.map((e) => e.version)).toEqual(['0.17.0', '0.16.1', '0.10.0', '0.9.0'])
    expect(merged[1]!.changes).toEqual(['generated'])
  })
})
