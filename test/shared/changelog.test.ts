import { describe, it, expect } from 'vitest'
import { CHANGELOG } from '../../src/shared/changelog'
import pkg from '../../package.json'

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

  it('documents the current package.json version', () => {
    const versions = CHANGELOG.map((e) => e.version)
    expect(versions, `add a CHANGELOG entry for v${pkg.version}`).toContain(pkg.version)
  })
})
