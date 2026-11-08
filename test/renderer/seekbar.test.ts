import { describe, it, expect } from 'vitest'
import { formatClock } from '../../src/renderer/src/lib/format'
import { seekGeometry, liveBufferFill } from '../../src/renderer/src/features/player/seekGeometry'

describe('formatClock', () => {
  it('uses h:mm:ss when the reference duration has hours (stable width)', () => {
    expect(formatClock(394, 6612)).toBe('0:06:34')
    expect(formatClock(6612, 6612)).toBe('1:50:12')
  })
  it('uses m:ss for short media', () => {
    expect(formatClock(394)).toBe('6:34')
    expect(formatClock(5, 600)).toBe('0:05')
  })
  it('prefixes a minus for remaining time and handles unknowns', () => {
    expect(formatClock(-6218, 6612)).toBe('-1:43:38')
    expect(formatClock(null)).toBe('—')
    expect(formatClock(Number.NaN)).toBe('—')
  })
})

describe('seekGeometry', () => {
  it('gives the played and loaded percentages of the track', () => {
    expect(seekGeometry(394, 1000, 6612)).toEqual({ playedPct: (394 / 6612) * 100, bufferedPct: (1000 / 6612) * 100 })
  })
  it('never shows the loaded part behind the cursor nor beyond the end', () => {
    expect(seekGeometry(500, 100, 1000)).toEqual({ playedPct: 50, bufferedPct: 50 })
    expect(seekGeometry(900, 5000, 1000)).toEqual({ playedPct: 90, bufferedPct: 100 })
    expect(seekGeometry(-3, null, 1000)).toEqual({ playedPct: 0, bufferedPct: 0 })
  })
  it('is empty without a known duration', () => {
    expect(seekGeometry(10, 20, 0)).toEqual({ playedPct: 0, bufferedPct: 0 })
    expect(seekGeometry(10, 20, null)).toEqual({ playedPct: 0, bufferedPct: 0 })
  })
})

describe('liveBufferFill', () => {
  it('maps the seconds loaded ahead onto a 30 s window', () => {
    expect(liveBufferFill(100, 115)).toEqual({ aheadSecs: 15, pct: 50 })
    expect(liveBufferFill(100, 190)).toEqual({ aheadSecs: 90, pct: 100 })
    expect(liveBufferFill(100, 90)).toEqual({ aheadSecs: 0, pct: 0 })
    expect(liveBufferFill(100, null)).toEqual({ aheadSecs: 0, pct: 0 })
  })
})
