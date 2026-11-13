/**
 * Bridges the player to the watch-progress store: the PlayerController reports
 * what is playing and where; this decides what to keep (see shared/progress.ts)
 * and tells the renderer when a row changed for good.
 *
 * Kept out of PlayerController so the controller stays free of the database
 * (its unit tests run without the native SQLite module).
 */

import { EventChannels, progressUpdate } from '@shared/index'
import type { EventEmitterFn, PlayRequest, ProgressKind } from '@shared/index'
import * as progressRepo from '../store/progressRepo'

export interface PlaybackProgressSink {
  /** A playback was requested (used to remember recently watched channels). */
  started(req: PlayRequest): void
  /**
   * Position report for a movie / episode. `final` = playback is stopping (the
   * renderer is told); `ended` = the file was played to its end.
   */
  position(
    req: PlayRequest,
    positionSecs: number,
    durationSecs: number | null,
    opts: { ended: boolean; final: boolean }
  ): void
}

export function createProgressSink(emit: EventEmitterFn): PlaybackProgressSink {
  const changed = (): void => emit(EventChannels.PROGRESS_CHANGED, {})
  const snapshot = (
    req: PlayRequest,
    kind: ProgressKind
  ): { kind: ProgressKind; itemId: number; name: string; image: string | null; containerExtension: string | null; seriesId: number | null } => ({
    kind,
    itemId: req.streamId as number,
    name: req.title ?? '',
    image: req.image ?? null,
    containerExtension: req.containerExtension ?? null,
    seriesId: req.seriesId ?? null
  })

  return {
    started(req) {
      if (req.mediaKind !== 'live' || req.streamId == null) return
      progressRepo.saveProgress({
        ...snapshot(req, 'live'),
        positionSecs: 0,
        durationSecs: null,
        watched: false
      })
      changed()
    },

    position(req, positionSecs, durationSecs, { ended, final }) {
      const kind = req.mediaKind ?? 'movie'
      if (req.streamId == null || (kind !== 'movie' && kind !== 'series')) return
      const update = progressUpdate(positionSecs, durationSecs, ended)
      if (update) {
        progressRepo.saveProgress({
          ...snapshot(req, kind),
          positionSecs: update.positionSecs,
          durationSecs,
          watched: update.watched
        })
      }
      if (final) changed()
    }
  }
}
