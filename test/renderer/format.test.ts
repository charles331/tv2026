import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  formatEta,
  formatPercent,
  formatRating,
  formatDateFromEpochSecs,
  trailerUrl
} from '../../src/renderer/src/lib/format'

describe('formatBytes (fr locale, decimal units)', () => {
  it('returns an em dash for null / invalid / negative', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
  it('formats zero and sub-Ko values without decimals', () => {
    expect(formatBytes(0)).toBe('0 o')
    expect(formatBytes(512)).toBe('512 o')
    expect(formatBytes(1023)).toBe('1023 o')
  })
  it('uses a comma decimal separator from Ko upward', () => {
    expect(formatBytes(1024)).toBe('1,0 Ko')
    expect(formatBytes(1536)).toBe('1,5 Ko')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5,0 Go')
  })
  it('drops decimals when the value is >= 100', () => {
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 Mo')
  })
})

describe('formatSpeed', () => {
  it('returns an em dash for non-positive / null', () => {
    expect(formatSpeed(null)).toBe('—')
    expect(formatSpeed(0)).toBe('—')
    expect(formatSpeed(-5)).toBe('—')
  })
  it('appends /s to a formatted byte rate', () => {
    expect(formatSpeed(1024)).toBe('1,0 Ko/s')
  })
})

describe('formatDuration', () => {
  it('returns an em dash for null / invalid / negative', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })
  it('formats seconds, minutes, and hours', () => {
    expect(formatDuration(9)).toBe('9 s')
    expect(formatDuration(130)).toBe('2 min 10 s')
    expect(formatDuration(6150)).toBe('1 h 42 min')
    expect(formatDuration(3600)).toBe('1 h 00 min')
  })
  it('zero-pads the secondary unit', () => {
    expect(formatDuration(125)).toBe('2 min 05 s')
  })
})

describe('formatEta', () => {
  it('returns an em dash for null / negative', () => {
    expect(formatEta(null)).toBe('—')
    expect(formatEta(-1)).toBe('—')
  })
  it('says "quelques instants" for sub-second ETAs', () => {
    expect(formatEta(0)).toBe('quelques instants')
    expect(formatEta(0.4)).toBe('quelques instants')
  })
  it('delegates to formatDuration otherwise', () => {
    expect(formatEta(130)).toBe('2 min 10 s')
  })
})

describe('formatPercent', () => {
  it('returns an em dash for null / invalid', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(NaN)).toBe('—')
  })
  it('rounds a 0..1 ratio to a percentage', () => {
    expect(formatPercent(0)).toBe('0 %')
    expect(formatPercent(0.474)).toBe('47 %')
    expect(formatPercent(1)).toBe('100 %')
  })
})

describe('formatRating', () => {
  it('returns an em dash for null / non-positive', () => {
    expect(formatRating(null)).toBe('—')
    expect(formatRating(0)).toBe('—')
    expect(formatRating(-2)).toBe('—')
  })
  it('formats with one decimal and a comma', () => {
    expect(formatRating(7.4)).toBe('7,4')
    expect(formatRating(8)).toBe('8,0')
  })
})

describe('formatDateFromEpochSecs', () => {
  it('returns an em dash for null / invalid', () => {
    expect(formatDateFromEpochSecs(null)).toBe('—')
    expect(formatDateFromEpochSecs(NaN)).toBe('—')
  })
  it('formats a valid epoch into a string containing the year', () => {
    // 2021-03-12T00:00:00Z
    const out = formatDateFromEpochSecs(1615507200)
    expect(out).not.toBe('—')
    expect(out).toMatch(/2021/)
  })
})

describe('trailerUrl', () => {
  it('returns null for empty / null', () => {
    expect(trailerUrl(null)).toBeNull()
    expect(trailerUrl('')).toBeNull()
    expect(trailerUrl('   ')).toBeNull()
  })
  it('passes through an http(s) URL unchanged', () => {
    expect(trailerUrl('https://youtu.be/xyz')).toBe('https://youtu.be/xyz')
    expect(trailerUrl('http://example.com/v')).toBe('http://example.com/v')
  })
  it('treats a bare value as a YouTube video id', () => {
    expect(trailerUrl('abc123')).toBe('https://www.youtube.com/watch?v=abc123')
  })
})
