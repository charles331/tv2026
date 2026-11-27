/**
 * What the Bibliothèque shows about watching: per episode (watched, started,
 * not watched yet) and, for a series card, how many episodes are left. Pure.
 */
import { progressRatio, resumeStart } from '@shared/index'
import type { WatchProgress } from '@shared/index'

export type WatchState = 'watched' | 'started' | 'new'

export interface EpisodeWatch {
  state: WatchState
  /** Where it was stopped (started only). */
  positionSecs: number
  /** Share played, 0 when the runtime is unknown. */
  ratio: number
}

export function episodeWatch(progress: WatchProgress | null | undefined): EpisodeWatch {
  if (progress?.watched) return { state: 'watched', positionSecs: 0, ratio: 1 }
  if (progress && resumeStart(progress) != null)
    return { state: 'started', positionSecs: progress.positionSecs, ratio: progressRatio(progress) }
  return { state: 'new', positionSecs: 0, ratio: 0 }
}

/** Caption of a series card, e.g. "3 à voir sur 5". */
export function seriesWatchSummary(states: WatchState[]): string {
  const n = states.length
  const left = states.filter((s) => s !== 'watched').length
  if (left === 0) return `Tout vu (${n})`
  if (left === n) return n === 1 ? '1 épisode, pas vu' : `${n} épisodes, aucun vu`
  return `${left} à voir sur ${n}`
}
