import { describe, it, expect } from 'vitest'
import { boundMessage, scrubSecrets } from '../../src/main/log/scrub'

describe('scrubSecrets', () => {
  it('masks Xtream stream paths (live/movie/series) that embed credentials', () => {
    expect(scrubSecrets('open http://host:8080/live/alice/s3cret/42.ts failed')).toBe(
      'open http://host:8080/live/***/***/42.ts failed'
    )
    expect(scrubSecrets('GET /movie/user/pass/9.mkv 404')).toBe('GET /movie/***/***/9.mkv 404')
    expect(scrubSecrets('/series/u/p/7.mkv')).toBe('/series/***/***/7.mkv')
  })

  it('masks URL userinfo', () => {
    expect(scrubSecrets('via https://bob:hunter2@panel.example/x')).toBe(
      'via https://***:***@panel.example/x'
    )
  })

  it('masks credential-ish query params', () => {
    expect(scrubSecrets('player_api.php?username=bob&password=pw&action=x')).toBe(
      'player_api.php?username=***&password=***&action=x'
    )
    expect(scrubSecrets('u?token=abc123&x=1')).toBe('u?token=***&x=1')
    expect(scrubSecrets('t?api_key=KEY')).toBe('t?api_key=***')
  })

  it('leaves innocent text untouched', () => {
    expect(scrubSecrets('mpv terminé (code 0)')).toBe('mpv terminé (code 0)')
    expect(scrubSecrets('Téléchargement #3 → completed')).toBe('Téléchargement #3 → completed')
  })
})

describe('boundMessage', () => {
  it('flattens newlines to a single line', () => {
    expect(boundMessage('a\nb\r\nc')).toBe('a ⏎ b ⏎ c')
  })
  it('caps overly long messages', () => {
    const long = 'x'.repeat(3000)
    const out = boundMessage(long, 100)
    expect(out.length).toBe(101) // 100 chars + ellipsis
    expect(out.endsWith('…')).toBe(true)
  })
  it('trims surrounding whitespace', () => {
    expect(boundMessage('  ok  ')).toBe('ok')
  })
})
