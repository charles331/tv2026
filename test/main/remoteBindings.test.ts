import { describe, it, expect } from 'vitest'
import { remoteBindings } from '../../src/main/player/remoteBindings'

describe('remoteBindings', () => {
  it('live: arrows zap, OK shows the channel, Back leaves', () => {
    const live = remoteBindings(true)
    expect(live).toContain('LEFT script-message tv2026 previous')
    expect(live).toContain('UP script-message tv2026 previous')
    expect(live).toContain('RIGHT script-message tv2026 next')
    expect(live).toContain('DOWN script-message tv2026 next')
    expect(live).toContain('ENTER show-text "${media-title}" 3000')
    expect(live).toContain('ESC script-message tv2026 back')
  })
  it('movie / episode: OK pauses, ←/→ seek, ↑/↓ tracks, pages change episode', () => {
    const vod = remoteBindings(false)
    expect(vod).toContain('ENTER cycle pause; show-progress')
    expect(vod).toContain('LEFT seek -10; show-progress')
    expect(vod).toContain('RIGHT seek 30; show-progress')
    expect(vod).toContain('UP cycle audio')
    expect(vod).toContain('DOWN cycle sub')
    expect(vod).toContain('PGDWN script-message tv2026 next')
    expect(vod).toContain('PGUP script-message tv2026 previous')
    expect(vod.some((l) => l.startsWith('RIGHT script-message'))).toBe(false)
  })
  it('every Back key leaves, in both', () => {
    for (const live of [true, false]) {
      for (const k of ['ESC', 'BS', 'BACK', 'MBTN_BACK', 'Alt+LEFT']) {
        expect(remoteBindings(live)).toContain(`${k} script-message tv2026 back`)
      }
    }
  })
})
