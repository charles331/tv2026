import { describe, expect, it, vi } from 'vitest'

const logged: { level: string; scope: string; message: string }[] = []
vi.mock('../../src/main/log/logger', () => ({
  appLog: {
    info: (scope: string, message: string) => logged.push({ level: 'info', scope, message }),
    error: (scope: string, message: string) => logged.push({ level: 'error', scope, message })
  }
}))

const { withRefreshLog } = await import('../../src/main/xtream/refreshLog')

describe('withRefreshLog', () => {
  it('logs the counts and the duration on success', async () => {
    let t = 1000
    const r = await withRefreshLog(
      'catalog',
      'Catalogue des films',
      async () => ({ streams: 26000, categories: 120 }),
      (x) => `${x.streams} films, ${x.categories} catégories`,
      () => (t += 2500)
    )
    expect(r.streams).toBe(26000)
    expect(logged.at(-1)).toEqual({
      level: 'info',
      scope: 'catalog',
      message: 'Catalogue des films mis à jour : 26000 films, 120 catégories en 2.5 s'
    })
  })

  it('logs the failure and rethrows the same error', async () => {
    const boom = new Error('v.trim is not a function')
    await expect(
      withRefreshLog('series', 'Catalogue des séries', () => Promise.reject(boom), () => '')
    ).rejects.toBe(boom)
    expect(logged.at(-1)).toEqual({
      level: 'error',
      scope: 'series',
      message: 'Catalogue des séries non mis à jour : v.trim is not a function'
    })
  })
})
