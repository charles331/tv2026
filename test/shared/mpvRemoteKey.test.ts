import { describe, it, expect } from 'vitest'
import { isMpvRemoteKey, MPV_KEY_FOR_ACTION } from '../../src/shared/mpvRemoteKey'

describe('isMpvRemoteKey', () => {
  it('accepts only the closed list of remote keys', () => {
    for (const k of ['ENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'ESC', 'PGUP', 'PGDWN']) {
      expect(isMpvRemoteKey(k)).toBe(true)
    }
  })
  it('refuses anything else (no command can be smuggled to mpv)', () => {
    expect(isMpvRemoteKey('q')).toBe(false)
    expect(isMpvRemoteKey('ENTER; quit')).toBe(false)
    expect(isMpvRemoteKey('enter')).toBe(false)
    expect(isMpvRemoteKey(13)).toBe(false)
    expect(isMpvRemoteKey(undefined)).toBe(false)
  })
  it('maps every remote action to one of those keys', () => {
    for (const k of Object.values(MPV_KEY_FOR_ACTION)) expect(isMpvRemoteKey(k)).toBe(true)
    expect(MPV_KEY_FOR_ACTION.back).toBe('ESC')
    expect(MPV_KEY_FOR_ACTION.ok).toBe('ENTER')
  })
})
