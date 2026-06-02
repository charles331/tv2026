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
import type { UpdateCheckOutcome } from '@shared/index'

let started = false

/** Compare dotted numeric versions; true if `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db
  }
  return false
}

/**
 * Manually trigger an update check (the "Vérifier les mises à jour" button).
 * In a packaged build, electron-updater downloads a newer release automatically
 * (autoDownload) and installs it on quit (autoInstallOnAppQuit). Never throws.
 */
export async function checkForUpdatesNow(): Promise<UpdateCheckOutcome> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    return {
      status: 'dev-disabled',
      currentVersion,
      message: 'Les mises à jour automatiques ne sont actives que dans l’application installée.'
    }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo?.version
    if (latestVersion && isNewer(latestVersion, currentVersion)) {
      return {
        status: 'available',
        currentVersion,
        latestVersion,
        message: `Mise à jour ${latestVersion} disponible : téléchargement en arrière-plan. Elle s’installera à la fermeture de l’application.`
      }
    }
    return {
      status: 'up-to-date',
      currentVersion,
      latestVersion: latestVersion ?? currentVersion,
      message: 'Vous utilisez déjà la dernière version.'
    }
  } catch (e) {
    return {
      status: 'error',
      currentVersion,
      message: `Échec de la vérification : ${(e as Error)?.message ?? 'erreur inconnue'}.`
    }
  }
}

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
