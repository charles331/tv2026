/**
 * Catalogue service — orchestrates the XtreamClient + SQLite cache.
 *
 * Reads (listCategories / listStreams / search) are served entirely from
 * SQLite via catalogRepo (paginated / LIKE in SQL — the 26k-row catalogue is
 * NEVER loaded into memory at once). Only `refresh` and a cache-miss `getInfo`
 * hit the provider.
 *
 * All functions return clean domain types or throw a typed XtreamError; the IPC
 * handlers convert that into a Result envelope.
 */

import type { RefreshCatalogResult, VodInfo } from '@shared/index'
import { catalogRepo } from '../store'
import { getXtreamClient } from './index'

/** A populated cache exists if it has at least one stream. */
export function isCatalogPopulated(): boolean {
  return catalogRepo.catalogCounts().streams > 0
}

/**
 * Refresh the catalogue cache from the provider: fetch all categories, then all
 * VOD streams (one bulk call), and upsert them into SQLite in a transaction.
 *
 * Single-connection-safe: this issues only player_api.php metadata requests,
 * sequentially. It does NOT touch the movie/stream endpoint.
 *
 * `force` is accepted for API symmetry; a non-forced refresh on an already
 * populated cache is a no-op that just reports current counts.
 */
export async function refreshCatalog(force: boolean): Promise<RefreshCatalogResult> {
  if (!force && isCatalogPopulated()) {
    const counts = catalogRepo.catalogCounts()
    return { categories: counts.categories, streams: counts.streams, refreshedAt: Date.now() }
  }

  const client = getXtreamClient()
  try {
    // Sequential: categories first, then the full stream list.
    const categories = await client.getVodCategories()
    catalogRepo.upsertCategories(categories)

    const streams = await client.getVodStreams()
    // Bulk upsert happens in a single DB transaction inside the repo.
    catalogRepo.upsertStreams(streams)

    const counts = catalogRepo.catalogCounts()
    return {
      categories: counts.categories,
      streams: counts.streams,
      refreshedAt: Date.now()
    }
  } finally {
    await client.close()
  }
}

/** TTL for cached get_vod_info (30 days — movie detail is essentially static). */
const VOD_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Return movie detail: serve from `vod_info_cache` when fresh, otherwise fetch
 * via the provider and cache it. Throws NOT_FOUND for unknown ids.
 */
export async function getVodInfo(streamId: number): Promise<VodInfo> {
  const cached = catalogRepo.getCachedVodInfo(streamId, VOD_INFO_TTL_MS)
  if (cached) return cached

  const client = getXtreamClient()
  try {
    const info = await client.getVodInfo(streamId)
    catalogRepo.cacheVodInfo(info)
    return info
  } finally {
    await client.close()
  }
}
