/**
 * Live service — orchestrates the XtreamClient live endpoints + SQLite cache.
 * Channels/categories are cached in SQLite (liveRepo); the short EPG is volatile
 * and served on demand with a tiny in-memory TTL cache (no persistence).
 */

import type { EpgEntry, GuideSearchResult, RefreshLiveResult } from '@shared/index'
import { epgRepo, liveRepo } from '../store'
import type { GuideProgrammeRow } from '../store/epgRepo'
import { getXtreamClient } from './index'
import { XmltvProgrammeParser } from './xmltv'
import { appLog } from '../log/logger'
import { withRefreshLog } from './refreshLog'

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

  return withRefreshLog(
    'live',
    'Liste des chaînes',
    async () => {
      const client = getXtreamClient()
      try {
        const categories = await client.getLiveCategories()
        liveRepo.upsertCategories(categories)

        const channels = await client.getLiveStreams()
        liveRepo.upsertChannels(channels)

        // The guide search depends on the channel list: refresh it too (best-effort,
        // a guide failure must not fail the channel refresh).
        await refreshGuide().catch((e) =>
          appLog.warn(
            'live',
            `Guide des programmes non mis à jour : ${e instanceof Error ? e.message : String(e)}`
          )
        )

        const counts = liveRepo.liveCounts()
        return { categories: counts.categories, channels: counts.channels, refreshedAt: Date.now() }
      } finally {
        await client.close()
      }
    },
    (r) => `${r.channels} chaînes, ${r.categories} catégories`
  )
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

/** Full-EPG in-memory cache: the full guide is larger; cache it for 5 min. */
const FULL_EPG_TTL_MS = 5 * 60_000
const fullEpgCache = new Map<number, { at: number; entries: EpgEntry[] }>()

/**
 * The complete programme guide for one channel (get_simple_data_table). Cached
 * in memory for 5 min. Best-effort: returns [] for EPG-less channels.
 */
export async function getFullEpg(streamId: number): Promise<EpgEntry[]> {
  const hit = fullEpgCache.get(streamId)
  if (hit && Date.now() - hit.at < FULL_EPG_TTL_MS) return hit.entries

  const client = getXtreamClient()
  try {
    const entries = await client.getFullEpg(streamId)
    fullEpgCache.set(streamId, { at: Date.now(), entries })
    return entries
  } finally {
    await client.close()
  }
}

// ------------------------------------------------------------ guide search

/** A guide older than this is re-downloaded before searching. */
const GUIDE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const GUIDE_TIMEOUT_MS = 180_000
let guideInFlight: Promise<number> | null = null

/**
 * Download the provider's full XMLTV guide (~60 MB, gzip) and replace the local
 * copy, keeping only programmes not yet ended on the user's channels. Streams
 * the body through the parser (never holds the raw file). Concurrent calls
 * share one download. Returns the number of programmes stored.
 */
export function refreshGuide(): Promise<number> {
  if (!guideInFlight) {
    guideInFlight = downloadGuide().finally(() => {
      guideInFlight = null
    })
  }
  return guideInFlight
}

async function downloadGuide(): Promise<number> {
  const started = Date.now()
  const client = getXtreamClient()
  const url = client.buildXmltvUrl()
  void client.close().catch(() => undefined)

  const known = epgRepo.knownEpgChannelIds()
  const nowSecs = Math.floor(Date.now() / 1000)
  const kept: GuideProgrammeRow[] = []
  let seen = 0
  const parser = new XmltvProgrammeParser((p) => {
    seen++
    if (p.endSecs > nowSecs && known.has(p.channel)) kept.push(p)
  })

  // fetch() transparently gunzips the body.
  const res = await fetch(url, {
    headers: { 'user-agent': 'tv2026', accept: 'application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(GUIDE_TIMEOUT_MS)
  })
  if (!res.ok || !res.body) throw new Error(`guide indisponible (HTTP ${res.status})`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(value)
  }
  parser.end()
  if (seen === 0) throw new Error('guide vide ou illisible')

  const stored = epgRepo.replaceGuide(kept, Date.now())
  appLog.info(
    'live',
    `Guide des programmes mis à jour : ${stored} programmes à venir sur vos chaînes (${seen} dans le fichier) en ${Math.round((Date.now() - started) / 100) / 10} s`
  )
  return stored
}

/**
 * Search programme titles/descriptions in the local guide (on air + upcoming),
 * re-downloading it first when missing or older than 6 h.
 */
export async function searchGuide(query: string, limit = 150): Promise<GuideSearchResult> {
  const fetchedAt = epgRepo.guideFetchedAt()
  if (fetchedAt == null || Date.now() - fetchedAt > GUIDE_MAX_AGE_MS) {
    try {
      await refreshGuide()
    } catch (e) {
      // Stale guide is better than none: search what we have, if anything.
      appLog.warn(
        'live',
        `Guide des programmes non mis à jour : ${e instanceof Error ? e.message : String(e)}`
      )
      if (fetchedAt == null) throw e
    }
  }
  const nowSecs = Math.floor(Date.now() / 1000)
  const { hits, truncated } = epgRepo.searchGuide(query, nowSecs, limit)
  return {
    hits,
    truncated,
    guideFetchedAt: epgRepo.guideFetchedAt(),
    guideProgrammes: epgRepo.upcomingCount(nowSecs)
  }
}
