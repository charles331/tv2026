import { describe, it, expect, vi, beforeEach } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('undici', () => {
  class Agent {
    constructor(_opts?: unknown) {}
    async close(): Promise<void> {}
  }
  return { Agent, request: requestMock }
})

import { XtreamClient } from '../../src/main/xtream/XtreamClient'
import type { XtreamCredentials } from '../../src/shared/types/settings'

const creds: XtreamCredentials = {
  baseUrl: 'http://provider.test:8080',
  username: 'user',
  password: 'pass'
}

function fakeRes(statusCode: number, body: string) {
  return {
    statusCode,
    headers: {},
    body: { text: async () => body, dump: async () => undefined }
  }
}

beforeEach(() => requestMock.mockReset())

describe('buildEpisodeUrl', () => {
  const client = new XtreamClient(creds)
  it('builds /series/USER/PASS/{id}.{ext}', () => {
    expect(client.buildEpisodeUrl(555, 'mkv')).toBe(
      'http://provider.test:8080/series/user/pass/555.mkv'
    )
  })
  it('strips leading dots and defaults to mkv', () => {
    expect(client.buildEpisodeUrl(7, '.mp4')).toBe('http://provider.test:8080/series/user/pass/7.mp4')
    expect(client.buildEpisodeUrl(7, '')).toBe('http://provider.test:8080/series/user/pass/7.mkv')
  })
})

describe('getSeriesCategories', () => {
  it('maps and coerces ids', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify([{ category_id: 7, category_name: 'Drame', parent_id: '0' }]))
    )
    const cats = await new XtreamClient(creds).getSeriesCategories()
    expect(cats).toEqual([{ categoryId: '7', categoryName: 'Drame', parentId: 0 }])
  })
  it('throws MALFORMED when not an array', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({})))
    await expect(new XtreamClient(creds).getSeriesCategories()).rejects.toMatchObject({
      kind: 'MALFORMED'
    })
  })
})

describe('getSeries', () => {
  it('maps, coerces ids and extracts year, dropping entries without id', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify([
          {
            series_id: '42',
            name: 'Foo (2019)',
            cover: 'http://img/cover.jpg',
            rating: '8',
            category_id: '7',
            last_modified: '1600000000',
            genre: 'Drama'
          },
          { name: 'no id' }
        ])
      )
    )
    const series = await new XtreamClient(creds).getSeries('7')
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      seriesId: 42,
      name: 'Foo (2019)',
      rating: 8,
      categoryId: '7',
      year: 2019,
      lastModified: 1600000000,
      genre: 'Drama'
    })
  })
})

describe('getSeriesInfo', () => {
  it('flattens the season-keyed episodes object into ordered seasons', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify({
          info: {
            name: 'Foo',
            plot: 'A plot.',
            genre: 'Drama',
            rating: '8.4',
            cover_big: 'http://img/big.jpg',
            youtube_trailer: 'abc123',
            releaseDate: '2019-01-01'
          },
          seasons: [{ season_number: 1 }, { season_number: 2 }],
          episodes: {
            '2': [
              { id: '201', episode_num: '1', title: 'S2E1', container_extension: 'mkv' }
            ],
            '1': [
              { id: '102', episode_num: '2', title: 'S1E2', container_extension: 'mp4' },
              {
                id: '101',
                episode_num: '1',
                title: 'S1E1',
                container_extension: 'mkv',
                info: { duration_secs: '2580', rating: '7.9' }
              }
            ]
          }
        })
      )
    )
    const info = await new XtreamClient(creds).getSeriesInfo(42)
    expect(info.name).toBe('Foo')
    expect(info.year).toBe(2019)
    expect(info.rating).toBe(8.4)
    expect(info.trailer).toBe('https://www.youtube.com/watch?v=abc123')
    // Seasons sorted ascending.
    expect(info.seasons.map((s) => s.seasonNumber)).toEqual([1, 2])
    // Season 1 episodes sorted by episodeNum.
    expect(info.seasons[0].episodes.map((e) => e.episodeId)).toEqual([101, 102])
    expect(info.seasons[0].episodes[0]).toMatchObject({
      episodeId: 101,
      season: 1,
      episodeNum: 1,
      containerExtension: 'mkv',
      durationSecs: 2580,
      rating: 7.9
    })
  })

  it('throws NOT_FOUND when there are no episodes', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({ info: [] })))
    await expect(new XtreamClient(creds).getSeriesInfo(999)).rejects.toMatchObject({
      kind: 'NOT_FOUND'
    })
  })
})
