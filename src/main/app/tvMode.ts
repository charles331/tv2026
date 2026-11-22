/**
 * TV mode state (main process): on when the setting says so or the app was
 * launched with --tv (this session only). Listeners hear every change of the
 * effective value: full screen, the player's remote keys, the renderer.
 */
import { settingsRepo } from '../store'
import { effectiveTvMode, type LaunchFlags } from './launchFlags'

let sessionFlags: LaunchFlags = { tv: false }
let last: boolean | null = null
const listeners = new Set<(on: boolean) => void>()

export function initTvMode(flags: LaunchFlags): void {
  sessionFlags = flags
}

/** A second launch with --tv: TV mode for the rest of this session. */
export function forceTvModeForSession(): void {
  sessionFlags = { ...sessionFlags, tv: true }
  refreshTvMode()
}

export function isTvMode(): boolean {
  return effectiveTvMode(settingsRepo.getSettings(), sessionFlags)
}

export function onTvModeChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Re-evaluates (after a settings change, a launch flag…) and notifies on change. */
export function refreshTvMode(): void {
  const on = isTvMode()
  if (on === last) return
  last = on
  for (const fn of listeners) fn(on)
}
