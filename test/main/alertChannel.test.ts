import { describe, it, expect } from 'vitest'
import { alertChannel } from '../../src/main/reminders/alertChannel'

describe('alertChannel', () => {
  it('uses a Windows notification on the PC', () => {
    expect(alertChannel(false)).toBe('notification')
  })
  it('asks inside the app in TV mode (a notification needs a mouse click)', () => {
    expect(alertChannel(true)).toBe('prompt')
  })
})
