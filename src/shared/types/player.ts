/**
 * Player (mpv) domain types.
 * mpv-player-integrator drives the real mpv binary against these contracts.
 * Streaming from the provider consumes the single connection => it must
 * acquire the shared ConnectionLock (which pauses downloads).
 */

export type PlaySourceKind = 'local' | 'stream'

export interface PlayRequest {
  kind: PlaySourceKind
  /** Movie vs series episode — selects the provider URL for kind === 'stream'. */
  mediaKind?: 'movie' | 'series'
  /** For kind === 'local': absolute file path. */
  filePath?: string
  /** For kind === 'stream': the stream id (movie stream id or episode id). */
  streamId?: number
  containerExtension?: string
  /** Display title for window/overlay. */
  title?: string
  /** Optional start position in seconds (resume). */
  startSecs?: number
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlayerStatus {
  state: PlayerState
  /** Current playback position in seconds. */
  positionSecs: number
  /** Total duration in seconds, or null if unknown. */
  durationSecs: number | null
  /** 0..100. */
  volume: number
  muted: boolean
  fullscreen: boolean
  /** What is currently loaded. */
  source: PlaySourceKind | null
  title: string | null
  /** Set when state === 'error'. */
  error?: string
}

export interface SeekRequest {
  /** Absolute position in seconds. */
  positionSecs: number
}

export interface VolumeRequest {
  /** 0..100. */
  volume: number
  muted?: boolean
}

export interface FullscreenRequest {
  fullscreen: boolean
}

export interface SubtitleVisibleRequest {
  visible: boolean
}

/** Position tick pushed main -> renderer on the player position channel. */
export interface PlayerPositionEvent {
  positionSecs: number
  durationSecs: number | null
  state: PlayerState
}

/** State-change event pushed main -> renderer. */
export interface PlayerStateEvent {
  state: PlayerState
  error?: string
}
