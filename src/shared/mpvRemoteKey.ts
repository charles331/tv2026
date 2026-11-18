/**
 * Keys the app may relay to mpv (TV mode, while the app has the keyboard focus
 * over a playing video). A closed list: the IPC handler refuses anything else,
 * so no mpv command can be passed through `keypress`.
 */
export const MPV_REMOTE_KEYS = [
  'ENTER',
  'LEFT',
  'RIGHT',
  'UP',
  'DOWN',
  'ESC',
  'PGUP',
  'PGDWN'
] as const
export type MpvRemoteKey = (typeof MPV_REMOTE_KEYS)[number]

export function isMpvRemoteKey(v: unknown): v is MpvRemoteKey {
  return typeof v === 'string' && (MPV_REMOTE_KEYS as readonly string[]).includes(v)
}

/**
 * A remote action relayed to the video: Back leaves it (a stop, which also
 * works while mpv is not up yet), the others are keys pressed in mpv.
 */
export function relayCommand(
  action: keyof typeof MPV_KEY_FOR_ACTION
): { stop: true } | { key: MpvRemoteKey } {
  return action === 'back' ? { stop: true } : { key: MPV_KEY_FOR_ACTION[action] }
}

/** Player states during which the remote drives the video (it is on screen or coming). */
export function isRelayState(state: string): boolean {
  return (
    state === 'loading' || state === 'playing' || state === 'paused' || state === 'reconnecting'
  )
}

/** Remote action (lib/remote/keys) → the mpv key that does it in the video. */
export const MPV_KEY_FOR_ACTION: Record<
  'up' | 'down' | 'left' | 'right' | 'ok' | 'back',
  MpvRemoteKey
> = {
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  ok: 'ENTER',
  back: 'ESC'
}
