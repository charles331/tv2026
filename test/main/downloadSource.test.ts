import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tv2026-dlsource-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { initDatabase, closeDatabase } = await import('../../src/main/store/db')
const catalogRepo = await import('../../src/main/store/catalogRepo')
const seriesRepo = await import('../../src/main/store/seriesRepo')

describe('download → catalogue page lookup', () => {
  beforeAll(() => {
    initDatabase()
    catalogRepo.upsertCategories([{ categoryId: '1', categoryName: 'Films', parentId: 0 }])
    catalogRepo.upsertStreams([
      {
        streamId: 42,
        name: 'FR - Le Film (2026)',
        streamIcon: null,
        rating: 7,
        containerExtension: 'mkv',
        categoryId: '1',
        year: 2026,
        addedAt: null
      }
    ])
    seriesRepo.upsertCategories([{ categoryId: '9', categoryName: 'Séries', parentId: 0 }])
    seriesRepo.upsertSeries([
      { seriesId: 7, name: 'La Série', cover: null, rating: null, categoryId: '9', year: null, lastModified: null, plot: null, genre: null },
      { seriesId: 8, name: 'Autre', cover: null, rating: null, categoryId: '9', year: null, lastModified: null, plot: null, genre: null }
    ])
    const episode = (episodeId: number) => ({
      episodeId,
      title: `Épisode ${episodeId}`,
      season: 1,
      episodeNum: 1,
      containerExtension: 'mkv',
      durationSecs: null,
      plot: null,
      rating: null,
      image: null
    })
    const info = (seriesId: number, episodeIds: number[]) => ({
      seriesId,
      name: 'x',
      plot: null,
      cast: null,
      director: null,
      genre: null,
      year: null,
      rating: null,
      cover: null,
      backdropUrls: [],
      trailer: null,
      seasons: [{ seasonNumber: 1, name: null, episodes: episodeIds.map(episode) }]
    })
    // 1001 contains "1000" as a prefix: the LIKE prefilter must not confuse them.
    seriesRepo.cacheSeriesInfo(info(7, [1000]))
    seriesRepo.cacheSeriesInfo(info(8, [10001]))
  })

  afterAll(() => {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds a movie by stream id', () => {
    expect(catalogRepo.getStream(42)?.name).toBe('FR - Le Film (2026)')
    expect(catalogRepo.getStream(43)).toBeNull()
  })

  it('finds the series of an episode through the cached series info', () => {
    expect(seriesRepo.findSeriesByEpisode(1000)?.seriesId).toBe(7)
    expect(seriesRepo.findSeriesByEpisode(10001)?.seriesId).toBe(8)
    expect(seriesRepo.findSeriesByEpisode(100)).toBeNull()
  })
})
