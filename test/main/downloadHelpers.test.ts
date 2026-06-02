import { describe, it, expect } from 'vitest'
import {
  HttpStatusError,
  partPath,
  headerValue,
  parseContentRangeTotal,
  describeError,
  formatBytes
} from '../../src/main/downloads/helpers'

describe('partPath', () => {
  it('appends .part to the final path', () => {
    expect(partPath('/dl/Movie (2021).mkv')).toBe('/dl/Movie (2021).mkv.part')
  })
})

describe('headerValue', () => {
  it('returns the first element of a header array', () => {
    expect(headerValue(['a', 'b'])).toBe('a')
  })
  it('passes through a string and undefined', () => {
    expect(headerValue('x')).toBe('x')
    expect(headerValue(undefined)).toBeUndefined()
  })
})

describe('parseContentRangeTotal', () => {
  it('extracts the total from a well-formed Content-Range', () => {
    expect(parseContentRangeTotal('bytes 200-1023/1234')).toBe(1234)
  })
  it('tolerates trailing whitespace', () => {
    expect(parseContentRangeTotal('bytes 0-99/500  ')).toBe(500)
  })
  it('returns null for an unknown total (*) or malformed input', () => {
    expect(parseContentRangeTotal('bytes 0-0/*')).toBeNull()
    expect(parseContentRangeTotal('garbage')).toBeNull()
    expect(parseContentRangeTotal(undefined)).toBeNull()
    expect(parseContentRangeTotal('')).toBeNull()
  })
  it('returns null for a zero total', () => {
    expect(parseContentRangeTotal('bytes 0-0/0')).toBeNull()
  })
})

describe('formatBytes (binary units)', () => {
  it('formats common sizes with one decimal', () => {
    expect(formatBytes(0)).toBe('0.0 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(64 * 1024 * 1024)).toBe('64.0 MiB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GiB')
  })
  it('caps at the largest unit', () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TiB')
  })
})

describe('describeError', () => {
  it('maps auth-ish HTTP statuses to a token/auth message', () => {
    for (const code of [401, 403, 512]) {
      expect(describeError(new HttpStatusError(code))).toMatch(/Authentication failed/)
    }
  })
  it('maps 404 to a not-found message', () => {
    expect(describeError(new HttpStatusError(404))).toMatch(/not found/i)
  })
  it('reports other HTTP statuses verbatim', () => {
    expect(describeError(new HttpStatusError(500))).toBe('Provider returned HTTP 500.')
  })
  it('maps filesystem errno codes', () => {
    expect(describeError({ code: 'ENOSPC' })).toMatch(/Disk full/)
    expect(describeError({ code: 'ENOENT' })).toMatch(/unavailable/)
    expect(describeError({ code: 'EACCES' })).toMatch(/Permission denied/)
  })
  it('maps undici timeout error names', () => {
    expect(describeError({ name: 'ConnectTimeoutError' })).toMatch(/Network timeout/)
    expect(describeError({ name: 'HeadersTimeoutError' })).toMatch(/Network timeout/)
  })
  it('falls back to the error message, then a generic message', () => {
    expect(describeError(new Error('socket hang up'))).toBe('Download error: socket hang up')
    expect(describeError(null)).toBe('Unknown download error.')
    expect(describeError({})).toBe('Unknown download error.')
  })
})
