import { describe, it, expect } from 'vitest'
import {
  isMpvRemoteKey,
  MPV_KEY_FOR_ACTION,
  relayCommand,
  isRelayState
} from '../../src/shared/mpvRemoteKey'

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

describe('relayCommand', () => {
  it('Back leaves the video (a stop, which works even before mpv is up)', () => {
    expect(relayCommand('back')).toEqual({ stop: true })
  })
  it('the other actions are keys pressed in the video', () => {
    expect(relayCommand('ok')).toEqual({ key: 'ENTER' })
    expect(relayCommand('left')).toEqual({ key: 'LEFT' })
  })
})

describe('isRelayState', () => {
  it('relays only while a video is on screen or coming', () => {
    for (const s of ['loading', 'playing', 'paused', 'reconnecting'])
      expect(isRelayState(s)).toBe(true)
    for (const s of ['idle', 'ended', 'error']) expect(isRelayState(s)).toBe(false)
  })
})
