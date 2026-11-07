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

import type { FileCheckResult, RefreshCatalogResult, VodInfo } from '@shared/index'
import { catalogRepo, settingsRepo } from '../store'
import { probeFileSize } from '../quality/fileProbe'
import { probeMedia } from '../quality/mediaProbe'
import { resolveMpvBinary } from '../player/mpvBinary'
import { transferUserAgent } from '../downloads/DownloadManager'
import { appLog } from '../log/logger'
import { getXtreamClient } from './index'
import { fetchTmdbMovie } from '../tmdb/TmdbClient'
import { getTmdbKey } from '../secrets/tmdbKey'

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
  if (cached) return enrichFromTmdb(cached)

  const client = getXtreamClient()
  try {
    const info = await client.getVodInfo(streamId)
    catalogRepo.cacheVodInfo(info)
    return enrichFromTmdb(info)
  } finally {
    await client.close()
  }
}

/**
 * Augment movie detail with the live TMDB rating + IMDb id when a TMDB API key
 * is configured and we have a TMDB id. Kept ALONGSIDE the provider's own rating
 * (both are shown in the UI). Best-effort: any failure leaves the info as-is.
 * The enriched result is re-cached so subsequent views are instant.
 */
async function enrichFromTmdb(info: VodInfo): Promise<VodInfo> {
  if (info.tmdbId == null) return info
  // Already enriched (rating + imdb resolved) — nothing to do.
  if (info.tmdbRating != null && info.imdbId != null) return info
  const apiKey = getTmdbKey()
  if (!apiKey) return info

  const tmdb = await fetchTmdbMovie(apiKey, info.tmdbId)
  if (!tmdb) return info

  const enriched: VodInfo = {
    ...info,
    tmdbRating: tmdb.rating ?? info.tmdbRating,
    tmdbVoteCount: tmdb.voteCount ?? info.tmdbVoteCount,
    imdbId: tmdb.imdbId ?? info.imdbId ?? null
  }
  catalogRepo.cacheVodInfo(enriched)
  return enriched
}

/**
 * Real file size of a movie, for the quality verdict shown BEFORE downloading.
 * A known size is served from SQLite (a file doesn't change); otherwise one
 * 1-byte request is made — automatically when the setting is on, or when the
 * user explicitly asks (`manual`). Never waits for the single connection.
 */
export async function checkMovieFile(streamId: number, manual: boolean): Promise<FileCheckResult> {
  const known = catalogRepo.getFileCheck(streamId)
  if (known) return { status: 'ok', ...known }
  if (!manual && !settingsRepo.getSettings().qualityCheck) return { status: 'disabled' }

  const info = await getVodInfo(streamId)
  const client = getXtreamClient()
  try {
    const url = client.buildMovieUrl(streamId, info.containerExtension)
    const out = await probeFileSize(url, { userAgent: transferUserAgent() })
    if (out.kind === 'busy') return { status: 'busy' }
    if (out.kind === 'error') {
      appLog.warn('catalog', `Vérification du fichier #${streamId} impossible : ${out.message}`)
      return { status: 'error', message: out.message }
    }
    const row = { sizeBytes: out.sizeBytes, durationSecs: info.durationSecs, checkedAt: Date.now() }
    catalogRepo.saveFileCheck(streamId, row)
    return { status: 'ok', ...row, video: null }
  } finally {
    await client.close()
  }
}

/**
 * "Analyser": read the file's REAL resolution and codec (mpv decodes its first
 * frame — a few seconds, a few MB, under the single connection when free).
 * Ensures the size is known first, then stores the result next to it.
 */
export async function analyzeMovieFile(streamId: number): Promise<FileCheckResult> {
  const check = await checkMovieFile(streamId, true)
  if (check.status !== 'ok' || check.video) return check

  const binary = resolveMpvBinary()
  if (!binary) return { status: 'error', message: 'lecteur mpv introuvable' }
  const info = await getVodInfo(streamId)
  const client = getXtreamClient()
  try {
    const url = client.buildMovieUrl(streamId, info.containerExtension)
    const t0 = Date.now()
    const out = await probeMedia(url, { binary, userAgent: transferUserAgent() })
    if (out.kind === 'busy') return { status: 'busy' }
    if (out.kind === 'error') {
      appLog.warn('catalog', `Analyse du fichier #${streamId} impossible : ${out.message}`)
      return { status: 'error', message: out.message }
    }
    catalogRepo.saveFileVideo(streamId, out.video)
    appLog.info(
      'catalog',
      `Analyse du fichier #${streamId} : ${out.video.width}×${out.video.height} ${out.video.codec} (${Date.now() - t0} ms)`
    )
    return { ...check, video: out.video }
  } finally {
    await client.close()
  }
}
