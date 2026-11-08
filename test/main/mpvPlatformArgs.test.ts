import { describe, it, expect } from 'vitest'
import { mpvPlatformArgs, isWsl } from '../../src/main/player/mpvPlatform'

describe('isWsl', () => {
  it('detects WSL from its environment variable or the kernel string', () => {
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, '')).toBe(true)
    expect(isWsl({}, 'Linux version 6.18.54.1-microsoft-standard-WSL2 (gcc …)')).toBe(true)
    expect(isWsl({}, 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-075)')).toBe(false)
  })
})

describe('mpvPlatformArgs', () => {
  it('forces X11 under WSL: WSLg Wayland windows cannot be resized', () => {
    expect(mpvPlatformArgs('linux', true)).toEqual(['--gpu-context=x11egl'])
  })
  it('changes nothing on a regular Linux desktop or on Windows', () => {
    expect(mpvPlatformArgs('linux', false)).toEqual([])
    expect(mpvPlatformArgs('win32', false)).toEqual([])
  })
})
