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

import { parseTmdbMovie, buildTmdbMovieUrl, fetchTmdbMovie } from '../../src/main/tmdb/TmdbClient'

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

describe('parseTmdbMovie', () => {
  it('extracts rating, vote count and imdb id', () => {
    expect(
      parseTmdbMovie({ vote_average: 7.2, vote_count: 1500, imdb_id: 'tt26749549' })
    ).toEqual({ rating: 7.2, voteCount: 1500, imdbId: 'tt26749549' })
  })

  it('coerces string numbers', () => {
    expect(parseTmdbMovie({ vote_average: '6.5', vote_count: '10' })).toEqual({
      rating: 6.5,
      voteCount: 10,
      imdbId: null
    })
  })

  it('nulls the rating when there are no votes, but still returns the imdb id', () => {
    expect(parseTmdbMovie({ vote_average: 7, vote_count: 0, imdb_id: 'tt1' })).toEqual({
      rating: null,
      voteCount: null,
      imdbId: 'tt1'
    })
  })

  it('ignores a malformed imdb id', () => {
    expect(parseTmdbMovie({ vote_average: 8, vote_count: 5, imdb_id: '12345' })).toEqual({
      rating: 8,
      voteCount: 5,
      imdbId: null
    })
  })

  it('clamps the average to 0–10 and truncates votes', () => {
    expect(parseTmdbMovie({ vote_average: 11, vote_count: 1500.9 })).toEqual({
      rating: 10,
      voteCount: 1500,
      imdbId: null
    })
  })

  it('returns null for non-objects', () => {
    expect(parseTmdbMovie(null)).toBeNull()
    expect(parseTmdbMovie('nope')).toBeNull()
    expect(parseTmdbMovie(undefined)).toBeNull()
  })
})

describe('buildTmdbMovieUrl', () => {
  it('targets the movie-details endpoint with the api key', () => {
    expect(buildTmdbMovieUrl(123, 'KEY123')).toBe(
      'https://api.themoviedb.org/3/movie/123?api_key=KEY123'
    )
  })
})

describe('fetchTmdbMovie', () => {
  it('returns the parsed rating + imdb id on success', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify({ vote_average: 7.2, vote_count: 1500, imdb_id: 'tt26749549' }))
    )
    expect(await fetchTmdbMovie('KEY', 26749549)).toEqual({
      rating: 7.2,
      voteCount: 1500,
      imdbId: 'tt26749549'
    })
  })

  it('returns null on a non-2xx response (bad key / not found)', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(401, '{"status_code":7}'))
    expect(await fetchTmdbMovie('BAD', 123)).toBeNull()
    requestMock.mockResolvedValueOnce(fakeRes(404, '{"status_code":34}'))
    expect(await fetchTmdbMovie('KEY', 999999999)).toBeNull()
  })

  it('returns null when the request throws (network error)', async () => {
    requestMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect(await fetchTmdbMovie('KEY', 123)).toBeNull()
  })

  it('short-circuits without a key or a valid id (no request made)', async () => {
    expect(await fetchTmdbMovie('', 123)).toBeNull()
    expect(await fetchTmdbMovie('KEY', 0)).toBeNull()
    expect(await fetchTmdbMovie('KEY', -5)).toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })
})
