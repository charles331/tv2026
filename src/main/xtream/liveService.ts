/**
 * Live service — orchestrates the XtreamClient live endpoints + SQLite cache.
 * Channels/categories are cached in SQLite (liveRepo); the short EPG is volatile
 * and served on demand with a tiny in-memory TTL cache (no persistence).
 */

import type { EpgEntry, RefreshLiveResult } from '@shared/index'
import { liveRepo } from '../store'
import { getXtreamClient } from './index'

/** A populated live cache exists if it has at least one channel. */
export function isLivePopulated(): boolean {
  return liveRepo.liveCounts().channels > 0
}

/**
 * Refresh the live cache from the provider: categories + the full channel list.
 * Single-connection-safe (only player_api.php metadata, sequential).
 */
export async function refreshLive(force: boolean): Promise<RefreshLiveResult> {
  if (!force && isLivePopulated()) {
    const counts = liveRepo.liveCounts()
    return { categories: counts.categories, channels: counts.channels, refreshedAt: Date.now() }
  }

  const client = getXtreamClient()
  try {
    const categories = await client.getLiveCategories()
    liveRepo.upsertCategories(categories)

    const channels = await client.getLiveStreams()
    liveRepo.upsertChannels(channels)

    const counts = liveRepo.liveCounts()
    return { categories: counts.categories, channels: counts.channels, refreshedAt: Date.now() }
  } finally {
    await client.close()
  }
}

/** Short-EPG in-memory cache: the guide changes slowly; avoid hammering. */
const EPG_TTL_MS = 60_000
const epgCache = new Map<number, { at: number; entries: EpgEntry[] }>()

/**
 * Now/next programmes for one channel. Cached in memory for 60s. Best-effort:
 * never throws for EPG-less channels (the client returns []).
 */
export async function getShortEpg(streamId: number, limit = 2): Promise<EpgEntry[]> {
  const hit = epgCache.get(streamId)
  if (hit && Date.now() - hit.at < EPG_TTL_MS) return hit.entries

  const client = getXtreamClient()
  try {
    const entries = await client.getShortEpg(streamId, limit)
    epgCache.set(streamId, { at: Date.now(), entries })
    return entries
  } finally {
    await client.close()
  }
}
