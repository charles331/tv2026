import { describe, it, expect } from 'vitest'
import { parseLaunchFlags, effectiveTvMode } from '../../src/main/app/launchFlags'

describe('parseLaunchFlags', () => {
  it('detects --tv among the arguments', () => {
    expect(parseLaunchFlags(['TV2026.exe', '--tv']).tv).toBe(true)
    expect(parseLaunchFlags(['electron', 'out/main/index.js', '--user-data-dir=x', '--tv']).tv).toBe(true)
  })
  it('ignores anything else', () => {
    expect(parseLaunchFlags(['TV2026.exe']).tv).toBe(false)
    expect(parseLaunchFlags(['TV2026.exe', '--tvx']).tv).toBe(false)
    expect(parseLaunchFlags(['TV2026.exe', 'tv']).tv).toBe(false)
  })
})

describe('effectiveTvMode', () => {
  it('is on when the setting or the launch flag says so', () => {
    expect(effectiveTvMode({ tvMode: false }, { tv: true })).toBe(true)
    expect(effectiveTvMode({ tvMode: true }, { tv: false })).toBe(true)
    expect(effectiveTvMode({ tvMode: false }, { tv: false })).toBe(false)
  })
})
