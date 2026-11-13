/**
 * File checks learnt during this session (movie page: size check, "Analyser"),
 * shared with the poster grid. The grid's items come from a list query made
 * before the check, so without this the size/quality label only appeared on the
 * poster after the list was reloaded.
 */
import { useSyncExternalStore } from 'react'
import type { VideoInfo } from '@shared/index'

export interface KnownFileCheck {
  sizeBytes: number
  durationSecs: number | null
  video: VideoInfo | null
}

const checks = new Map<number, KnownFileCheck>()
const listeners = new Set<() => void>()

export function publishFileCheck(streamId: number, check: KnownFileCheck): void {
  checks.set(streamId, check)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The latest check for this movie known in this session, or undefined. */
export function useFileCheck(streamId: number): KnownFileCheck | undefined {
  return useSyncExternalStore(subscribe, () => checks.get(streamId))
}
