/**
 * Auto-update wiring (electron-updater + GitHub Releases).
 *
 * Only active in a PACKAGED build: in dev there is nothing to update and
 * checking would fail. The published NSIS target ships a `latest.yml` that
 * electron-updater reads from the GitHub Release to detect newer versions.
 *
 * UX: updates download silently in the background and install on the next
 * app quit (autoInstallOnAppQuit). The user is notified by the OS when an
 * update has been downloaded. Failures (offline, rate limit, no release yet)
 * are swallowed — they must never crash or block the app.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

let started = false

/** Re-check interval while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 h

export function initAutoUpdates(): void {
  if (!app.isPackaged || started) return
  started = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const check = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Best-effort: ignore network / no-release / rate-limit errors.
    })
  }

  check()
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  // Don't keep the event loop alive just for the update timer.
  timer.unref?.()
}
