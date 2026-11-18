/**
 * TV mode « Éteindre » menu: leaving the app alone would strand the user on the
 * Windows desktop with only a remote, so the menu also offers sleep and shut
 * down. Closed list of actions; system tools run with execFile (no shell).
 */
export const POWER_ACTIONS = ['quit', 'sleep', 'shutdown'] as const
export type PowerAction = (typeof POWER_ACTIONS)[number]

export function isPowerAction(v: unknown): v is PowerAction {
  return typeof v === 'string' && (POWER_ACTIONS as readonly string[]).includes(v)
}

/** The system command for sleep / shut down, or null where not offered. */
export function powerCommand(
  action: 'sleep' | 'shutdown',
  platform: NodeJS.Platform
): { file: string; args: string[] } | null {
  if (platform !== 'win32') return null
  // Note: SetSuspendState hibernates instead when hibernation is enabled.
  if (action === 'sleep')
    return { file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] }
  return { file: 'shutdown.exe', args: ['/s', '/t', '0'] }
}
