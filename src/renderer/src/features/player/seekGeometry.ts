/**
 * Pure geometry of the playback progress bar: how much of the track is played
 * (up to the cursor) and how much is already loaded by mpv (cursor → end of its
 * demuxer cache). Percentages of the track width, clamped to [0, 100].
 */

const clampPct = (v: number): number => Math.min(100, Math.max(0, v))

export function seekGeometry(
  positionSecs: number,
  bufferedSecs: number | null | undefined,
  durationSecs: number | null | undefined
): { playedPct: number; bufferedPct: number } {
  if (!durationSecs || durationSecs <= 0) return { playedPct: 0, bufferedPct: 0 }
  const playedPct = clampPct((positionSecs / durationSecs) * 100)
  const loaded = bufferedSecs != null ? clampPct((bufferedSecs / durationSecs) * 100) : 0
  return { playedPct, bufferedPct: Math.max(playedPct, loaded) }
}

/** Live has no meaningful duration: show the seconds loaded ahead on a 30 s window. */
export const LIVE_BUFFER_WINDOW_SECS = 30

export function liveBufferFill(
  positionSecs: number,
  bufferedSecs: number | null | undefined
): { aheadSecs: number; pct: number } {
  const ahead = bufferedSecs != null ? Math.max(0, bufferedSecs - positionSecs) : 0
  return { aheadSecs: ahead, pct: clampPct((ahead / LIVE_BUFFER_WINDOW_SECS) * 100) }
}
