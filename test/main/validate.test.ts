import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import {
  ValidationError,
  assert,
  isObject,
  requireString,
  optionalString,
  requireNumber,
  requireInt,
  optionalNumber,
  optionalBoolean,
  requireBaseUrl,
  assertPathWithin
} from '../../src/main/ipc/validate'

describe('validate helpers', () => {
  describe('assert', () => {
    it('throws ValidationError on a falsy condition', () => {
      expect(() => assert(false, 'nope')).toThrow(ValidationError)
      expect(() => assert(0, 'nope')).toThrow('nope')
    })
    it('passes on a truthy condition', () => {
      expect(() => assert(1, 'ok')).not.toThrow()
    })
  })

  describe('isObject', () => {
    it('accepts plain objects only', () => {
      expect(isObject({})).toBe(true)
      expect(isObject({ a: 1 })).toBe(true)
    })
    it('rejects arrays, null, and primitives', () => {
      expect(isObject([])).toBe(false)
      expect(isObject(null)).toBe(false)
      expect(isObject('x')).toBe(false)
      expect(isObject(42)).toBe(false)
      expect(isObject(undefined)).toBe(false)
    })
  })

  describe('requireString', () => {
    it('returns the string', () => {
      expect(requireString({ k: 'hello' }, 'k')).toBe('hello')
    })
    it('throws on a non-string', () => {
      expect(() => requireString({ k: 5 }, 'k')).toThrow(ValidationError)
      expect(() => requireString({}, 'k')).toThrow(ValidationError)
    })
    it('enforces the max length', () => {
      expect(() => requireString({ k: 'abcd' }, 'k', 3)).toThrow(/too long/)
      expect(requireString({ k: 'abc' }, 'k', 3)).toBe('abc')
    })
  })

  describe('optionalString', () => {
    it('returns undefined for null / undefined', () => {
      expect(optionalString({ k: undefined }, 'k')).toBeUndefined()
      expect(optionalString({ k: null }, 'k')).toBeUndefined()
      expect(optionalString({}, 'k')).toBeUndefined()
    })
    it('validates when present', () => {
      expect(optionalString({ k: 'v' }, 'k')).toBe('v')
      expect(() => optionalString({ k: 1 }, 'k')).toThrow(ValidationError)
    })
  })

  describe('requireNumber / requireInt', () => {
    it('accepts finite numbers', () => {
      expect(requireNumber({ k: 3.5 }, 'k')).toBe(3.5)
    })
    it('rejects NaN / Infinity / non-number', () => {
      expect(() => requireNumber({ k: NaN }, 'k')).toThrow(ValidationError)
      expect(() => requireNumber({ k: Infinity }, 'k')).toThrow(ValidationError)
      expect(() => requireNumber({ k: '3' }, 'k')).toThrow(ValidationError)
    })
    it('requireInt rejects non-integers', () => {
      expect(requireInt({ k: 7 }, 'k')).toBe(7)
      expect(() => requireInt({ k: 7.2 }, 'k')).toThrow(ValidationError)
    })
  })

  describe('optionalNumber / optionalBoolean', () => {
    it('optionalNumber handles absence and validity', () => {
      expect(optionalNumber({}, 'k')).toBeUndefined()
      expect(optionalNumber({ k: 2 }, 'k')).toBe(2)
      expect(() => optionalNumber({ k: NaN }, 'k')).toThrow(ValidationError)
    })
    it('optionalBoolean handles absence and validity', () => {
      expect(optionalBoolean({}, 'k')).toBeUndefined()
      expect(optionalBoolean({ k: true }, 'k')).toBe(true)
      expect(optionalBoolean({ k: false }, 'k')).toBe(false)
      expect(() => optionalBoolean({ k: 'true' }, 'k')).toThrow(ValidationError)
    })
  })

  describe('requireBaseUrl', () => {
    it('accepts http and https URLs', () => {
      expect(requireBaseUrl({ k: 'http://example.com:8080' }, 'k')).toBe(
        'http://example.com:8080'
      )
      expect(requireBaseUrl({ k: 'https://x.test' }, 'k')).toBe('https://x.test')
    })
    it('rejects non-http(s) schemes and garbage', () => {
      expect(() => requireBaseUrl({ k: 'ftp://x' }, 'k')).toThrow(ValidationError)
      expect(() => requireBaseUrl({ k: 'example.com' }, 'k')).toThrow(ValidationError)
    })
  })

  describe('assertPathWithin (path-traversal defense)', () => {
    // POSIX absolute paths so isAbsolute() holds on the (Linux/CI) test runner.
    const base = '/data/downloads'

    it('accepts a path inside the base dir and returns the resolved path', () => {
      const out = assertPathWithin('/data/downloads/Movie (2021).mkv', base)
      expect(out).toBe(resolve('/data/downloads/Movie (2021).mkv'))
    })

    it('accepts the base dir itself', () => {
      expect(() => assertPathWithin(base, base)).not.toThrow()
    })

    it('accepts a nested subdirectory', () => {
      expect(() => assertPathWithin('/data/downloads/sub/x.ts', base)).not.toThrow()
    })

    it('rejects traversal escaping the base dir', () => {
      expect(() => assertPathWithin('/data/downloads/../etc/passwd', base)).toThrow(
        ValidationError
      )
    })

    it('rejects a path entirely outside the base dir', () => {
      expect(() => assertPathWithin('/etc/passwd', base)).toThrow(ValidationError)
    })

    it('rejects a sibling dir sharing a name prefix', () => {
      expect(() => assertPathWithin('/data/downloads-evil/x', base)).toThrow(
        ValidationError
      )
    })

    it('rejects a relative filePath', () => {
      expect(() => assertPathWithin('relative/x.mkv', base)).toThrow(ValidationError)
    })

    it('rejects a NUL byte', () => {
      expect(() => assertPathWithin('/data/downloads/x\x00.mkv', base)).toThrow(
        ValidationError
      )
    })

    it('rejects an empty filePath', () => {
      expect(() => assertPathWithin('', base)).toThrow(ValidationError)
    })

    it('rejects a non-absolute base dir', () => {
      expect(() => assertPathWithin('/data/downloads/x', 'relative-base')).toThrow(
        ValidationError
      )
    })
  })
})
