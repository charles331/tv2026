/**
 * Watch-progress rules, shared by the main process (what to store) and the
 * renderer (what to offer). Pure functions: no I/O.
 */

import type { Episode, SeriesInfo } from './types/series'
import type { WatchProgress } from './types/progress'

/** Under one minute there is nothing worth resuming. */
export const RESUME_MIN_SECS = 60
/** Past this share of the runtime (end credits) the item counts as watched. */
export const WATCHED_RATIO = 0.9
/** Resume a little before the saved position, to pick the scene back up. */
export const RESUME_REWIND_SECS = 5

/**
 * What to store for a playback position, or null when it is not worth storing
 * (first minute). `ended` = mpv reached the end of the file.
 */
export function progressUpdate(
  positionSecs: number,
  durationSecs: number | null,
  ended: boolean
): { positionSecs: number; watched: boolean } | null {
  const watched =
    ended || (durationSecs != null && durationSecs > 0 && positionSecs / durationSecs >= WATCHED_RATIO)
  if (watched) return { positionSecs: 0, watched: true }
  if (positionSecs < RESUME_MIN_SECS) return null
  return { positionSecs: Math.floor(positionSecs), watched: false }
}

/** Position to resume from, or null to start from the beginning. */
export function resumeStart(progress: WatchProgress | null | undefined): number | null {
  if (!progress || progress.watched || progress.positionSecs < RESUME_MIN_SECS) return null
  return Math.max(0, progress.positionSecs - RESUME_REWIND_SECS)
}

/** Share already played (0..1), for a progress bar. */
export function progressRatio(progress: WatchProgress | null | undefined): number {
  if (!progress) return 0
  if (progress.watched) return 1
  if (!progress.durationSecs || progress.durationSecs <= 0) return 0
  return Math.min(1, Math.max(0, progress.positionSecs / progress.durationSecs))
}

/**
 * The episodes around `episodeId` in viewing order: seasons ascending, then
 * episode number. `next` after a season's last episode is the first of the
 * following season. Both null when the episode is unknown.
 */
export function episodeNeighbors(
  info: SeriesInfo,
  episodeId: number
): { previous: Episode | null; next: Episode | null } {
  const ordered = [...info.seasons]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((s) => [...s.episodes].sort((a, b) => a.episodeNum - b.episodeNum))
  const index = ordered.findIndex((e) => e.episodeId === episodeId)
  if (index < 0) return { previous: null, next: null }
  return { previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null }
}

/**
 * The items around `id` in an ordered list, wrapping around at both ends (the
 * way a TV remote zaps). Both null when `id` is absent or alone.
 */
export function wrapNeighbors<T>(
  ordered: T[],
  idOf: (item: T) => number,
  id: number
): { previous: T | null; next: T | null } {
  const index = ordered.findIndex((item) => idOf(item) === id)
  if (index < 0 || ordered.length < 2) return { previous: null, next: null }
  return {
    previous: ordered[(index - 1 + ordered.length) % ordered.length]!,
    next: ordered[(index + 1) % ordered.length]!
  }
}
