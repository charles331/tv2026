/**
 * Launch options. `--tv` (put in the mini PC's shortcut / autostart entry)
 * forces the TV mode for the session, whatever the setting says.
 */
export interface LaunchFlags {
  tv: boolean
}

export function parseLaunchFlags(argv: readonly string[]): LaunchFlags {
  return { tv: argv.includes('--tv') }
}

/** TV mode is on when the user turned it on in Réglages, or the app was launched with --tv. */
export function effectiveTvMode(settings: { tvMode: boolean }, flags: LaunchFlags): boolean {
  return settings.tvMode || flags.tv
}
