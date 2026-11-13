/**
 * Watch progress: where the user stopped in a movie or an episode (to resume),
 * whether it was watched, and which live channels were watched recently.
 *
 * Like favorites, a row stores a SNAPSHOT (name/image/…) so "Reprendre" can
 * list and replay an item without its catalogue row.
 */

/** Same values as `PlayRequest.mediaKind`: 'series' is ONE EPISODE, not a series. */
export type ProgressKind = 'movie' | 'series' | 'live'

export interface WatchProgress {
  kind: ProgressKind
  /** Movie stream id, episode id, or live channel stream id. */
  itemId: number
  /** Where to resume, in seconds (0 once watched, and for live channels). */
  positionSecs: number
  /** Total duration in seconds, when mpv reported it. */
  durationSecs: number | null
  /** True once played (almost) to the end. */
  watched: boolean
  /** Unix epoch ms of the last update (drives "most recent first"). */
  updatedAt: number
  /** Display title, e.g. "Série S01E03". */
  name: string
  /** Poster / cover / channel logo URL. */
  image: string | null
  containerExtension: string | null
  /** For an episode: its series (to chain episodes and reopen the series page). */
  seriesId: number | null
}

/** Identify a progress row. */
export interface ProgressRef {
  kind: ProgressKind
  itemId: number
}

/** Mark an item watched / not watched by hand (carries the snapshot). */
export interface SetWatchedRequest extends ProgressRef {
  watched: boolean
  name: string
  image?: string | null
  containerExtension?: string | null
  seriesId?: number | null
}
