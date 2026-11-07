import { describe, it, expect } from 'vitest'
import {
  detectLowQualityTag,
  fileQuality,
  parseClockDuration,
  videoLabel,
  QUALITY_THRESHOLDS_MBPS
} from '../../src/shared/quality'

describe('detectLowQualityTag', () => {
  it.each([
    ['FR - Moulin (2026) CAM', 'CAM'],
    ['FR - Les Misérables - 2026 CAM', 'CAM'],
    ['Film.2026.HDCAM.x264', 'HDCAM'],
    ['Film (2026) [TS]', 'TS'],
    ['Film 2026 TELESYNC', 'TELESYNC'],
    ['Film 2026 hdts', 'HDTS'],
    ['Film 2026 TC', 'TC']
  ])('flags %s as %s', (name, tag) => {
    expect(detectLowQualityTag(name)).toBe(tag)
  })

  it.each([
    'Dune : Deuxième partie',
    'Camille redouble', // "Cam" inside a word
    'Ratatouille',
    'The Batman (2022)',
    'Tsunami (2004)', // "Ts" inside a word
    'Mission: Impossible – Dead Reckoning'
  ])('does not flag %s', (name) => {
    expect(detectLowQualityTag(name)).toBeNull()
  })
})

describe('fileQuality', () => {
  // Real measurements from the provider (sizes from Content-Range, durations from `duration`).
  it('rates the real CAM copies as low', () => {
    const moulin = fileQuality(634_618_816, 130 * 60)!
    expect(moulin.level).toBe('low')
    expect(moulin.mbps).toBeCloseTo(0.65, 2)
    expect(fileQuality(1_431_098_552, 178 * 60)!.level).toBe('low')
    expect(fileQuality(853_924_635, 134 * 60)!.level).toBe('low')
  })

  it('uses the documented thresholds (low < 1.2 ≤ medium < 2.5 ≤ good)', () => {
    expect(QUALITY_THRESHOLDS_MBPS).toEqual({ low: 1.2, medium: 2.5 })
    const secs = 3600
    const bytesFor = (mbps: number): number => (mbps * 1e6 * secs) / 8
    expect(fileQuality(bytesFor(1.19), secs)!.level).toBe('low')
    expect(fileQuality(bytesFor(1.2), secs)!.level).toBe('medium')
    expect(fileQuality(bytesFor(2.49), secs)!.level).toBe('medium')
    expect(fileQuality(bytesFor(2.5), secs)!.level).toBe('good')
    expect(fileQuality(4.8e9, 166 * 60)!.level).toBe('good')
  })

  it('returns null when size or duration is unknown or nonsensical', () => {
    expect(fileQuality(null, 3600)).toBeNull()
    expect(fileQuality(1e9, null)).toBeNull()
    expect(fileQuality(1e9, 0)).toBeNull()
    expect(fileQuality(0, 3600)).toBeNull()
  })
})

describe('parseClockDuration', () => {
  it('parses HH:MM:SS', () => {
    expect(parseClockDuration('02:10:00')).toBe(7800)
    expect(parseClockDuration('01:42:30')).toBe(6150)
  })
  it('parses MM:SS', () => {
    expect(parseClockDuration('95:00')).toBe(5700)
  })
  it('returns null for empty, zero or garbage', () => {
    expect(parseClockDuration('')).toBeNull()
    expect(parseClockDuration(null)).toBeNull()
    expect(parseClockDuration(undefined)).toBeNull()
    expect(parseClockDuration('00:00:00')).toBeNull()
    expect(parseClockDuration('2h10')).toBeNull()
  })
})

describe('fileQuality with the real resolution/codec (Analyser)', () => {
  const secs = 3600
  const bytesFor = (mbps: number): number => (mbps * 1e6 * secs) / 8

  it('credits efficient codecs: 2 Mbit/s HEVC 1080p is good, the same in H.264 is medium', () => {
    const odyssee = { width: 1920, height: 800, codec: 'hevc' }
    expect(fileQuality(bytesFor(1.97), secs, odyssee)!.level).toBe('good')
    expect(fileQuality(bytesFor(1.97), secs, { ...odyssee, codec: 'h264' })!.level).toBe('medium')
    expect(fileQuality(bytesFor(1.97), secs, { ...odyssee, codec: 'av1' })!.level).toBe('good')
  })

  it('keeps the raw bitrate for display', () => {
    expect(fileQuality(bytesFor(2), secs, { width: 1920, height: 1080, codec: 'hevc' })!.mbps).toBeCloseTo(2, 5)
  })

  it('never rates an SD picture as good, and a CAM bitrate stays low even in HEVC', () => {
    expect(fileQuality(bytesFor(6), secs, { width: 720, height: 576, codec: 'h264' })!.level).toBe('medium')
    expect(fileQuality(bytesFor(0.6), secs, { width: 1920, height: 1080, codec: 'hevc' })!.level).toBe('low')
  })

  it('falls back to the bitrate-only verdict without video info', () => {
    expect(fileQuality(bytesFor(1.97), secs, null)!.level).toBe('medium')
  })
})

describe('videoLabel', () => {
  it.each([
    [{ width: 3840, height: 1600, codec: 'hevc' }, '4K · HEVC'],
    [{ width: 1920, height: 800, codec: 'hevc' }, '1080p · HEVC'],
    [{ width: 1280, height: 720, codec: 'h264' }, '720p · H.264'],
    [{ width: 720, height: 576, codec: 'mpeg2video' }, 'SD · MPEG-2'],
    [{ width: 1920, height: 1080, codec: 'av1' }, '1080p · AV1'],
    [{ width: 1920, height: 1080, codec: 'weird' }, '1080p · WEIRD']
  ])('%o → %s', (v, label) => {
    expect(videoLabel(v)).toBe(label)
  })
})
