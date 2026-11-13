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
 * The episode that follows `episodeId`: next in its season, else the first of
 * the next season. Null after the last one (or if the episode is unknown).
 */
export function findNextEpisode(info: SeriesInfo, episodeId: number): Episode | null {
  const ordered = [...info.seasons]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((s) => [...s.episodes].sort((a, b) => a.episodeNum - b.episodeNum))
  const index = ordered.findIndex((e) => e.episodeId === episodeId)
  return index >= 0 ? (ordered[index + 1] ?? null) : null
}
