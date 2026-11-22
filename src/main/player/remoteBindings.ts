/**
 * mpv key bindings of the TV mode (remote control: arrows, OK, Back), one line
 * per key, written to an `input.conf` passed with --input-conf. Keys the app
 * itself acts on are sent back with `script-message tv2026 <action>`, which
 * reaches the app as a `client-message` event on the JSON IPC.
 * Key names checked against `mpv --input-keylist` (BACK, not XF86_BACK).
 */
const BACK_KEYS = ['ESC', 'BS', 'BACK', 'MBTN_BACK', 'Alt+LEFT']

export function remoteBindings(live: boolean): string[] {
  const lines = live
    ? [
        'ENTER show-text "${media-title}" 3000',
        'KP_ENTER show-text "${media-title}" 3000',
        'LEFT script-message tv2026 previous',
        'UP script-message tv2026 previous',
        'RIGHT script-message tv2026 next',
        'DOWN script-message tv2026 next'
      ]
    : [
        'ENTER cycle pause; show-progress',
        'KP_ENTER cycle pause; show-progress',
        'SPACE cycle pause; show-progress',
        'PLAYPAUSE cycle pause; show-progress',
        'LEFT seek -10; show-progress',
        'RIGHT seek 30; show-progress',
        'UP cycle audio',
        'DOWN cycle sub',
        'PGUP script-message tv2026 previous',
        'PGDWN script-message tv2026 next'
      ]
  return [...lines, ...BACK_KEYS.map((k) => `${k} script-message tv2026 back`)]
}
