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

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64')

beforeEach(() => requestMock.mockReset())

describe('buildLiveUrl', () => {
  const client = new XtreamClient(creds)
  it('builds /live/USER/PASS/{id}.ts by default', () => {
    expect(client.buildLiveUrl(321)).toBe('http://provider.test:8080/live/user/pass/321.ts')
  })
  it('accepts an explicit extension and strips dots', () => {
    expect(client.buildLiveUrl(321, '.m3u8')).toBe(
      'http://provider.test:8080/live/user/pass/321.m3u8'
    )
  })
})

describe('getLiveCategories', () => {
  it('maps and coerces ids', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(200, JSON.stringify([{ category_id: 3, category_name: 'Sport', parent_id: '0' }]))
    )
    expect(await new XtreamClient(creds).getLiveCategories()).toEqual([
      { categoryId: '3', categoryName: 'Sport', parentId: 0 }
    ])
  })
  it('throws MALFORMED when not an array', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({})))
    await expect(new XtreamClient(creds).getLiveCategories()).rejects.toMatchObject({
      kind: 'MALFORMED'
    })
  })
})

describe('getLiveStreams', () => {
  it('maps channels, coerces ids and reads archive flag, dropping entries without id', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify([
          {
            stream_id: '101',
            num: '12',
            name: 'TF1',
            stream_icon: 'http://img/tf1.png',
            epg_channel_id: 'tf1.fr',
            category_id: '3',
            tv_archive: '1'
          },
          { name: 'no id' }
        ])
      )
    )
    const channels = await new XtreamClient(creds).getLiveStreams('3')
    expect(channels).toHaveLength(1)
    expect(channels[0]).toEqual({
      streamId: 101,
      name: 'TF1',
      icon: 'http://img/tf1.png',
      number: 12,
      epgChannelId: 'tf1.fr',
      categoryId: '3',
      hasArchive: true
    })
  })
})

describe('getShortEpg', () => {
  it('decodes base64 titles/descriptions and maps timestamps + now flag', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify({
          epg_listings: [
            {
              title: b64('Journal de 20h'),
              description: b64('Les infos du soir'),
              start_timestamp: '1700000000',
              stop_timestamp: '1700003600',
              now_playing: '1'
            },
            {
              title: b64('Film du soir'),
              description: '',
              start_timestamp: '1700003600',
              stop_timestamp: '1700010800',
              now_playing: '0'
            }
          ]
        })
      )
    )
    const epg = await new XtreamClient(creds).getShortEpg(101, 2)
    expect(epg).toHaveLength(2)
    expect(epg[0]).toEqual({
      title: 'Journal de 20h',
      description: 'Les infos du soir',
      startSecs: 1700000000,
      endSecs: 1700003600,
      nowPlaying: true,
      epgId: null,
      hasArchive: false
    })
    expect(epg[1].title).toBe('Film du soir')
    expect(epg[1].description).toBeNull()
    expect(epg[1].nowPlaying).toBe(false)
  })

  it('returns an empty array when there is no EPG', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({ epg_listings: [] })))
    expect(await new XtreamClient(creds).getShortEpg(101)).toEqual([])
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({})))
    expect(await new XtreamClient(creds).getShortEpg(101)).toEqual([])
  })
})

describe('getFullEpg', () => {
  it('maps the full guide, reads epg_id + has_archive, and sorts by start', async () => {
    requestMock.mockResolvedValueOnce(
      fakeRes(
        200,
        JSON.stringify({
          epg_listings: [
            {
              id: '55',
              epg_id: '42',
              title: b64('Second'),
              description: '',
              start_timestamp: '1700003600',
              stop_timestamp: '1700007200',
              now_playing: '0',
              has_archive: '1'
            },
            {
              id: '54',
              title: b64('Premier'),
              description: '',
              start_timestamp: '1700000000',
              stop_timestamp: '1700003600',
              now_playing: '1',
              has_archive: '0'
            }
          ]
        })
      )
    )
    const epg = await new XtreamClient(creds).getFullEpg(101)
    expect(epg.map((e) => e.title)).toEqual(['Premier', 'Second'])
    // epg_id preferred over id; archive flag coerced from 0/1
    expect(epg[0]).toMatchObject({ epgId: '54', hasArchive: false, nowPlaying: true })
    expect(epg[1]).toMatchObject({ epgId: '42', hasArchive: true })
  })

  it('returns an empty array when there is no guide', async () => {
    requestMock.mockResolvedValueOnce(fakeRes(200, JSON.stringify({})))
    expect(await new XtreamClient(creds).getFullEpg(101)).toEqual([])
  })
})
