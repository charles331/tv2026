/**
 * Series service — orchestrates the XtreamClient series endpoints + SQLite cache.
 * Mirrors catalogService: reads come from seriesRepo; only refresh and a
 * cache-miss getSeriesInfo hit the provider.
 */

import type { RefreshSeriesResult, SeriesInfo } from '@shared/index'
import { seriesRepo } from '../store'
import { getXtreamClient } from './index'

/** A populated series cache exists if it has at least one series. */
export function isSeriesPopulated(): boolean {
  return seriesRepo.seriesCounts().series > 0
}

/**
 * Refresh the series cache from the provider: categories + the full series list.
 * Single-connection-safe (only player_api.php metadata, sequential).
 */
export async function refreshSeries(force: boolean): Promise<RefreshSeriesResult> {
  if (!force && isSeriesPopulated()) {
    const counts = seriesRepo.seriesCounts()
    return { categories: counts.categories, series: counts.series, refreshedAt: Date.now() }
  }

  const client = getXtreamClient()
  try {
    const categories = await client.getSeriesCategories()
    seriesRepo.upsertCategories(categories)

    const series = await client.getSeries()
    seriesRepo.upsertSeries(series)

    const counts = seriesRepo.seriesCounts()
    return { categories: counts.categories, series: counts.series, refreshedAt: Date.now() }
  } finally {
    await client.close()
  }
}

/** TTL for cached get_series_info (7 days — episodes can change as a show airs). */
const SERIES_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Return series detail (seasons + episodes): serve from cache when fresh,
 * otherwise fetch via the provider and cache it. Throws NOT_FOUND for unknown ids.
 */
export async function getSeriesInfo(seriesId: number): Promise<SeriesInfo> {
  const cached = seriesRepo.getCachedSeriesInfo(seriesId, SERIES_INFO_TTL_MS)
  if (cached) return cached

  const client = getXtreamClient()
  try {
    const info = await client.getSeriesInfo(seriesId)
    seriesRepo.cacheSeriesInfo(info)
    return info
  } finally {
    await client.close()
  }
}
