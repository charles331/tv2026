import { describe, it, expect } from 'vitest'
import {
  progressUpdate,
  resumeStart,
  progressRatio,
  episodeNeighbors,
  wrapNeighbors
} from '../../src/shared/progress'
import type { SeriesInfo, WatchProgress } from '../../src/shared'

const row = (patch: Partial<WatchProgress>): WatchProgress => ({
  kind: 'movie',
  itemId: 1,
  positionSecs: 0,
  durationSecs: 6000,
  watched: false,
  updatedAt: 0,
  name: 'Film',
  image: null,
  containerExtension: 'mkv',
  seriesId: null,
  ...patch
})

describe('progressUpdate', () => {
  it('ignores the first minute (nothing worth resuming)', () => {
    expect(progressUpdate(0, 6000, false)).toBeNull()
    expect(progressUpdate(59, 6000, false)).toBeNull()
  })
  it('records a position past the first minute', () => {
    expect(progressUpdate(2592.4, 6000, false)).toEqual({ positionSecs: 2592, watched: false })
  })
  it('marks as watched in the last 10 % (credits)', () => {
    expect(progressUpdate(5400, 6000, false)).toEqual({ positionSecs: 0, watched: true })
    expect(progressUpdate(5399, 6000, false)?.watched).toBe(false)
  })
  it('marks as watched when playback reached the end, whatever the position', () => {
    expect(progressUpdate(10, null, true)).toEqual({ positionSecs: 0, watched: true })
  })
  it('keeps recording when the duration is unknown', () => {
    expect(progressUpdate(300, null, false)).toEqual({ positionSecs: 300, watched: false })
  })
})

describe('resumeStart', () => {
  it('resumes a few seconds before the saved position', () => {
    expect(resumeStart(row({ positionSecs: 2592 }))).toBe(2587)
  })
  it('starts from the beginning when watched, unknown or barely started', () => {
    expect(resumeStart(null)).toBeNull()
    expect(resumeStart(row({ positionSecs: 2592, watched: true }))).toBeNull()
    expect(resumeStart(row({ positionSecs: 30 }))).toBeNull()
  })
})

describe('progressRatio', () => {
  it('is the share already played, 1 when watched, 0 when unknown', () => {
    expect(progressRatio(row({ positionSecs: 1500 }))).toBe(0.25)
    expect(progressRatio(row({ watched: true }))).toBe(1)
    expect(progressRatio(row({ positionSecs: 1500, durationSecs: null }))).toBe(0)
    expect(progressRatio(null)).toBe(0)
  })
})

describe('episodeNeighbors', () => {
  const ep = (episodeId: number, season: number, episodeNum: number) => ({
    episodeId,
    title: `Ép ${episodeNum}`,
    season,
    episodeNum,
    containerExtension: 'mkv',
    durationSecs: null,
    plot: null,
    rating: null,
    image: null
  })
  const info = {
    seriesId: 7,
    name: 'Série',
    seasons: [
      { seasonNumber: 2, name: null, episodes: [ep(21, 2, 1)] },
      { seasonNumber: 1, name: null, episodes: [ep(12, 1, 2), ep(11, 1, 1)] }
    ]
  } as unknown as SeriesInfo

  it('follows the episode order inside a season', () => {
    const n = episodeNeighbors(info, 11)
    expect(n.previous).toBeNull()
    expect(n.next?.episodeId).toBe(12)
  })
  it('continues with the first episode of the next season, and back', () => {
    expect(episodeNeighbors(info, 12).next?.episodeId).toBe(21)
    expect(episodeNeighbors(info, 21).previous?.episodeId).toBe(12)
  })
  it('has no next after the last episode, and nothing for an unknown one', () => {
    expect(episodeNeighbors(info, 21).next).toBeNull()
    expect(episodeNeighbors(info, 999)).toEqual({ previous: null, next: null })
  })
})

describe('wrapNeighbors', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const idOf = (x: { id: number }): number => x.id
  it('gives the items around, wrapping at both ends', () => {
    expect(wrapNeighbors(list, idOf, 2)).toEqual({ previous: { id: 1 }, next: { id: 3 } })
    expect(wrapNeighbors(list, idOf, 1)).toEqual({ previous: { id: 3 }, next: { id: 2 } })
    expect(wrapNeighbors(list, idOf, 3)).toEqual({ previous: { id: 2 }, next: { id: 1 } })
  })
  it('gives nothing for an unknown or a lone item', () => {
    expect(wrapNeighbors(list, idOf, 9)).toEqual({ previous: null, next: null })
    expect(wrapNeighbors([{ id: 1 }], idOf, 1)).toEqual({ previous: null, next: null })
  })
})
