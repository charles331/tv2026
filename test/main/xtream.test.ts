import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * undici is mocked: the client must never hit the real network in a unit test.
 * `requestMock` is created via vi.hoisted so it exists before the (hoisted)
 * vi.mock factory runs. `Agent` is a no-op class (constructed in the client ctor).
 */
const requestMock = vi.hoisted(() => vi.fn())
vi.mock('undici', () => {
  class Agent {
    constructor(_opts?: unknown) {}
    async close(): Promise<void> {}
  }
  return { Agent, request: requestMock }
})

import { XtreamClient, maskUrl } from '../../src/main/xtream/XtreamClient'
import { XtreamError } from '../../src/main/xtream/errors'
import type { XtreamCredentials } from '../../src/shared/types/settings'

const creds: XtreamCredentials = {
  baseUrl: 'http://provider.test:8080',
  username: 'user',
  password: 'pass'
}

/** Build a fake undici response object with the bits the client reads. */
function fakeRes(
  statusCode: number,
  body: string,
  headers: Record<string, string | string[]> = {}
) {
  return {
    statusCode,
    headers,
    body: {
      text: async () => body,
      dump: async () => undefined
    }
  }
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('maskUrl', () => {
  it('redacts username and password query params', () => {
    const masked = maskUrl(
      'http://x/player_api.php?username=alice&password=secret&action=get_vod_streams'
    )
    expect(masked).not.toContain('alice')
    expect(masked).not.toContain('secret')
    expect(masked).toContain('username=***')
    expect(masked).toContain('password=***')
    expect(masked).toContain('action=get_vod_streams')
  })

  it('redacts the credentials embedded in a /movie/ URL', () => {
    const masked = maskUrl('http://x:8080/movie/alice/secret/123.mkv')
    expect(masked).toBe('http://x:8080/movie/***/***/123.mkv')
  })
})

describe('XtreamClient constructor', () => {
  it('throws NO_CREDENTIALS when fields are missing', () => {
    const attempt = () =>
      new XtreamClient({ baseUrl: '', username: '', password: '' } as XtreamCredentials)
    expect(attempt).toThrow(XtreamError)
    try {
      attempt()
    } catch (e) {
      expect((e as XtreamError).kind).toBe('NO_CREDENTIALS')
    }
  })
})

describe('buildMovieUrl', () => {
  const client = new XtreamClient(creds)

  it('builds the canonical /movie/USER/PASS/{id}.{ext} URL', () => {
    expect(client.buildMovieUrl(123, 'mkv')).toBe(
      'http://provider.test:8080/movie/user/pass/123.mkv'
    )
  })

  it('strips leading dots from the extension and defaults to mkv', () => {
    expect(client.buildMovieUrl(7, '.ts')).toBe(
      'http://provider.test:8080/movie/user/pass/7.ts'
    )
    expect(client.buildMovieUrl(7, '')).toBe(
      'http://provider.test:8080/movie/user/pass/7.mkv'
    )
  })

  it('url-encodes special characters in credentials', () => {
    const c = new XtreamClient({
      baseUrl: 'http://x:8080',
      username: 'a b',
      password: 'p/?&'
    })
    const url = c.buildMovieUrl(1, 'mp4')
    expect(url).toContain('/movie/a%20b/')
    expect(url).toContain(encodeURIComponent('p/?&'))
  })
})

describe('getAccountInfo', () => {
  it('normalizes a valid active account', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify({
          user_info: {
            username: 'user',
            auth: 1,
            status: 'Active',
            exp_date: '1800000000',
            max_connections: '1',
            active_cons: '0',
            is_trial: '0'
          },
          server_info: { url: 'provider.test', timezone: 'UTC', timestamp_now: '1700000000' }
        })
      )
    )
    const client = new XtreamClient(creds)
    const info = await client.getAccountInfo()
    expect(info.auth).toBe(1)
    expect(info.status).toBe('active')
    expect(info.expiresAt).toBe(1800000000)
    expect(info.maxConnections).toBe(1)
    expect(info.activeConnections).toBe(0)
    expect(info.isTrial).toBe(false)
    expect(info.server.timezone).toBe('UTC')
  })

  it('maps auth:0 to AUTH_FAILED', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify({ user_info: { auth: 0 } }))
    )
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'AUTH_FAILED' })
  })

  it('maps HTTP 512 (this panel quirk) to AUTH_FAILED', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(512, ''))
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'AUTH_FAILED' })
  })

  it('maps HTTP 401/403 to AUTH_FAILED', async () => {
    const client = new XtreamClient(creds)
    requestMock.mockResolvedValueOnce(fakeRes(401, ''))
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'AUTH_FAILED' })
    requestMock.mockResolvedValueOnce(fakeRes(403, ''))
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'AUTH_FAILED' })
  })

  it('maps other non-2xx to NETWORK_ERROR', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(500, ''))
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'NETWORK_ERROR' })
  })

  it('maps an empty / "false" body to MALFORMED', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, 'false'))
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'MALFORMED' })
  })

  it('maps non-JSON body to MALFORMED', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, '<html>nope</html>'))
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'MALFORMED' })
  })

  it('wraps a thrown network error as NETWORK_ERROR', async () => {
    requestMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const client = new XtreamClient(creds)
    await expect(client.getAccountInfo()).rejects.toMatchObject({ kind: 'NETWORK_ERROR' })
  })
})

describe('getVodCategories', () => {
  it('maps categories and coerces ids to strings/ints', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify([
          { category_id: 12, category_name: 'Action', parent_id: '0' },
          { category_id: '34', category_name: 'Comédie', parent_id: 5 }
        ])
      )
    )
    const client = new XtreamClient(creds)
    const cats = await client.getVodCategories()
    expect(cats).toEqual([
      { categoryId: '12', categoryName: 'Action', parentId: 0 },
      { categoryId: '34', categoryName: 'Comédie', parentId: 5 }
    ])
  })

  it('throws MALFORMED when the response is not an array', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({ not: 'an array' })))
    const client = new XtreamClient(creds)
    await expect(client.getVodCategories()).rejects.toMatchObject({ kind: 'MALFORMED' })
  })
})

describe('getVodStreams', () => {
  it('maps streams, coerces string ids, and applies defaults', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify([
          {
            stream_id: '101',
            name: 'Foo (2021)',
            stream_icon: 'http://img/1.jpg',
            rating: '7.5',
            container_extension: 'mp4',
            category_id: '12',
            added: '1600000000'
          },
          { stream_id: 102, name: 'NoExt Movie' } // missing ext -> defaults to mkv
        ])
      )
    )
    const client = new XtreamClient(creds)
    const streams = await client.getVodStreams('12')
    expect(streams).toHaveLength(2)
    expect(streams[0]).toMatchObject({
      streamId: 101,
      name: 'Foo (2021)',
      rating: 7.5,
      containerExtension: 'mp4',
      categoryId: '12',
      year: 2021
    })
    expect(streams[1].containerExtension).toBe('mkv')
  })

  it('drops entries without a usable stream_id', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify([
          { name: 'no id here' },
          { stream_id: 'abc', name: 'bad id' }, // non-numeric -> dropped
          { stream_id: 5, name: 'good' }
        ])
      )
    )
    const client = new XtreamClient(creds)
    const streams = await client.getVodStreams()
    expect(streams).toHaveLength(1)
    expect(streams[0].streamId).toBe(5)
  })
})

describe('getVodInfo', () => {
  it('maps full movie detail and builds a YouTube trailer URL', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify({
          info: {
            name: 'Foo',
            o_name: 'Foo Original',
            plot: 'A plot.',
            genre: 'Action',
            rating: '8.1',
            movie_image: 'http://img/poster.jpg',
            youtube_trailer: 'abc123',
            duration_secs: '6120',
            movie_size: '5368709120'
          },
          movie_data: { name: 'Foo', container_extension: 'mkv' }
        })
      )
    )
    const client = new XtreamClient(creds)
    const info = await client.getVodInfo(101)
    expect(info.streamId).toBe(101)
    expect(info.name).toBe('Foo')
    expect(info.title).toBe('Foo Original')
    expect(info.rating).toBe(8.1)
    expect(info.trailer).toBe('https://www.youtube.com/watch?v=abc123')
    expect(info.durationSecs).toBe(6120)
    expect(info.sizeBytes).toBe(5368709120)
    expect(info.containerExtension).toBe('mkv')
  })

  it('throws NOT_FOUND for an unknown id (info:[] / movie_data:null)', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify({ info: [], movie_data: null }))
    )
    const client = new XtreamClient(creds)
    await expect(client.getVodInfo(999)).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })
})
