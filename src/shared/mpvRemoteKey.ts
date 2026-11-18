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
