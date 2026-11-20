import { describe, it, expect } from 'vitest'
import { powerCommand, isPowerAction } from '../../src/main/app/power'

describe('powerCommand', () => {
  it('Windows: sleep and shut down with the system tools, no shell', () => {
    expect(powerCommand('sleep', 'win32')).toEqual({
      file: 'rundll32.exe',
      args: ['powrprof.dll,SetSuspendState', '0,1,0']
    })
    expect(powerCommand('shutdown', 'win32')).toEqual({
      file: 'shutdown.exe',
      args: ['/s', '/t', '0']
    })
  })
  it('other systems: not offered', () => {
    expect(powerCommand('sleep', 'linux')).toBeNull()
    expect(powerCommand('shutdown', 'darwin')).toBeNull()
  })
})

describe('isPowerAction', () => {
  it('accepts only quit, sleep and shutdown', () => {
    expect(isPowerAction('quit')).toBe(true)
    expect(isPowerAction('sleep')).toBe(true)
    expect(isPowerAction('shutdown')).toBe(true)
    expect(isPowerAction('reboot')).toBe(false)
    expect(isPowerAction('shutdown /r')).toBe(false)
    expect(isPowerAction(1)).toBe(false)
  })
})
