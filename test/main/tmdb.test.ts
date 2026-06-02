import { describe, it, expect, vi, beforeEach } from 'vitest'

// undici mocked: no real network in unit tests (see xtream.test.ts for the pattern).
const requestMock = vi.hoisted(() => vi.fn())
vi.mock('undici', () => {
  class Agent {
    constructor(_opts?: unknown) {}
    async close(): Promise<void> {}
  }
  return { Agent, request: requestMock }
})

import {
  parseTmdbRating,
  buildTmdbMovieUrl,
  fetchTmdbRating
} from '../../src/main/tmdb/TmdbClient'

function fakeRes(statusCode: number, body: string) {
  return {
    statusCode,
    body: {
      text: async () => body,
      dump: async () => undefined
    }
  }
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('parseTmdbRating', () => {
  it('extracts rating and vote count', () => {
    expect(parseTmdbRating({ vote_average: 7.2, vote_count: 1500 })).toEqual({
      rating: 7.2,
      voteCount: 1500
    })
  })

  it('coerces string numbers', () => {
    expect(parseTmdbRating({ vote_average: '6.5', vote_count: '10' })).toEqual({
      rating: 6.5,
      voteCount: 10
    })
  })

  it('returns null when there are no votes', () => {
    expect(parseTmdbRating({ vote_average: 7, vote_count: 0 })).toBeNull()
  })

  it('returns null for a zero / missing average', () => {
    expect(parseTmdbRating({ vote_average: 0, vote_count: 100 })).toBeNull()
    expect(parseTmdbRating({ vote_count: 100 })).toBeNull()
  })

  it('returns null for non-objects', () => {
    expect(parseTmdbRating(null)).toBeNull()
    expect(parseTmdbRating('nope')).toBeNull()
    expect(parseTmdbRating(undefined)).toBeNull()
  })

  it('clamps the average to 0–10 and truncates votes', () => {
    expect(parseTmdbRating({ vote_average: 11, vote_count: 1500.9 })).toEqual({
      rating: 10,
      voteCount: 1500
    })
  })
})

describe('buildTmdbMovieUrl', () => {
  it('targets the movie-details endpoint with the api key', () => {
    const url = buildTmdbMovieUrl(123, 'KEY123')
    expect(url).toBe('https://api.themoviedb.org/3/movie/123?api_key=KEY123')
  })
})

describe('fetchTmdbRating', () => {
  it('returns the parsed rating on success', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify({ vote_average: 7.2, vote_count: 1500 }))
    )
    const out = await fetchTmdbRating('KEY', 26749549)
    expect(out).toEqual({ rating: 7.2, voteCount: 1500 })
  })

  it('returns null on a non-2xx response (bad key / not found)', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(401, '{"status_code":7}'))
    expect(await fetchTmdbRating('BAD', 123)).toBeNull()
    requestMock.mockResolvedValueOnce(fakeRes(404, '{"status_code":34}'))
    expect(await fetchTmdbRating('KEY', 999999999)).toBeNull()
  })

  it('returns null when the request throws (network error)', async () => {
    requestMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect(await fetchTmdbRating('KEY', 123)).toBeNull()
  })

  it('short-circuits without a key or a valid id (no request made)', async () => {
    expect(await fetchTmdbRating('', 123)).toBeNull()
    expect(await fetchTmdbRating('KEY', 0)).toBeNull()
    expect(await fetchTmdbRating('KEY', -5)).toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })
})
