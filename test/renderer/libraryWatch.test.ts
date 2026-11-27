import { describe, expect, it } from 'vitest'
import type { WatchProgress } from '@shared/index'
import {
  episodeWatch,
  seriesWatchSummary
} from '../../src/renderer/src/features/library/libraryWatch'

function prog(p: Partial<WatchProgress>): WatchProgress {
  return {
    kind: 'series',
    itemId: 1,
    positionSecs: 0,
    durationSecs: null,
    watched: false,
    updatedAt: 0,
    name: 'x',
    image: null,
    containerExtension: null,
    seriesId: null,
    ...p
  } as WatchProgress
}

describe('episodeWatch', () => {
  it('never played → new', () => {
    expect(episodeWatch(undefined)).toEqual({ state: 'new', positionSecs: 0, ratio: 0 })
  })
  it('watched to the end → watched', () => {
    expect(episodeWatch(prog({ watched: true })).state).toBe('watched')
  })
  it('stopped at 20 min, runtime unknown → started, position kept, no ratio', () => {
    expect(episodeWatch(prog({ positionSecs: 1236 }))).toEqual({
      state: 'started',
      positionSecs: 1236,
      ratio: 0
    })
  })
  it('stopped half-way with a known runtime → started with its share', () => {
    expect(episodeWatch(prog({ positionSecs: 1200, durationSecs: 2400 })).ratio).toBe(0.5)
  })
  it('under a minute → still new (nothing to resume)', () => {
    expect(episodeWatch(prog({ positionSecs: 30 })).state).toBe('new')
  })
})

describe('seriesWatchSummary', () => {
  it('counts what is left to watch', () => {
    expect(seriesWatchSummary(['watched', 'started', 'new', 'new'])).toBe('3 à voir sur 4')
  })
  it('one left', () => {
    expect(seriesWatchSummary(['watched', 'new'])).toBe('1 à voir sur 2')
  })
  it('all watched', () => {
    expect(seriesWatchSummary(['watched', 'watched'])).toBe('Tout vu (2)')
  })
  it('none watched yet', () => {
    expect(seriesWatchSummary(['new', 'new', 'new'])).toBe('3 épisodes, aucun vu')
  })
  it('a single episode, not watched', () => {
    expect(seriesWatchSummary(['new'])).toBe('1 épisode, pas vu')
  })
})
