/**
 * App-update wiring (electron-updater + GitHub Releases) — USER-DRIVEN.
 *
 * Only active in a PACKAGED build: in dev there is nothing to update and
 * checking would fail. The published NSIS target ships a `latest.yml` that
 * electron-updater reads from the GitHub Release to detect newer versions.
 *
 * UX: nothing downloads or installs behind the user's back.
 *  1. A check (manual button or the 6-hourly background check) only DETECTS a
 *     newer release and notifies the renderer (UPDATE_STATUS 'available').
 *  2. The user explicitly accepts → downloadUpdateNow() streams progress ticks
 *     to the renderer ('downloading' → 'downloaded').
 *  3. The user clicks install → installUpdateNow() quits the app and runs the
 *     NSIS installer VISIBLY (non-silent), then relaunches the app.
 *
 * The last UPDATE_STATUS event is kept and exposed via getUpdateState() so the
 * renderer can sync on mount — push events can fire before it subscribes
 * (startup check vs React boot) or while Réglages is unmounted.
 *
 * Failures (offline, rate limit, no release yet) are swallowed or surfaced as
 * an 'error' event — they must never crash or block the app.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { EventEmitterFn, UpdateCheckOutcome, UpdateStatusEvent } from '@shared/index'
import { EventChannels, isVersionNewer } from '@shared/index'
import { appLog } from './log/logger'

let started = false
let emit: EventEmitterFn = () => {}
/** True between a user-accepted downloadUpdate() and its downloaded/error end. */
let downloading = false
/** Version an update has fully downloaded for (gates installUpdateNow). */
let downloadedVersion: string | null = null
/** Last emitted status — pulled by the renderer on mount (getUpdateState). */
let lastStatus: UpdateStatusEvent | null = null

function emitStatus(e: UpdateStatusEvent): void {
  lastStatus = e
  // Journal the lifecycle, but not the (chatty) per-tick download progress.
  if (e.phase !== 'downloading') {
    const line = `Mise à jour : ${e.phase}${e.latestVersion ? ` (${e.latestVersion})` : ''}${e.message ? ` — ${e.message}` : ''}`
    if (e.phase === 'error') appLog.error('updater', line)
    else appLog.info('updater', line)
  }
  emit(EventChannels.UPDATE_STATUS, e)
}

/** Last known update status, for mount-time sync in the renderer. */
export function getUpdateState(): UpdateStatusEvent | null {
  return lastStatus
}

/**
 * Manually trigger an update check (the "Vérifier les mises à jour" button).
 * Detection only — the download starts when the user accepts. Never throws.
 */
export async function checkForUpdatesNow(): Promise<UpdateCheckOutcome> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    return {
      status: 'dev-disabled',
      currentVersion,
      message: 'Les mises à jour ne sont actives que dans l’application installée.'
    }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo?.version
    if (latestVersion && isVersionNewer(latestVersion, currentVersion)) {
      return {
        status: 'available',
        currentVersion,
        latestVersion,
        message: `Mise à jour ${latestVersion} disponible. Téléchargez-la quand vous voulez — rien ne s’installe sans votre accord.`
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

/**
 * The user accepted the update → download it. Progress streams to the renderer
 * via UPDATE_STATUS events. A fresh check runs FIRST so a release published
 * after an earlier download is picked up (never silently reuse a stale one);
 * the already-downloaded short-circuit only applies to the SAME version.
 * Throws a plain Error on immediate failure; async failures surface as an
 * 'error' event.
 */
export async function downloadUpdateNow(): Promise<void> {
  if (!app.isPackaged) throw new Error('Mises à jour inactives hors application installée.')
  if (downloading) return // already in flight; progress events keep the UI live

  const check = await checkForUpdatesNow()
  if (check.status === 'error') {
    // Offline but an update is already fully downloaded → it stays installable.
    if (downloadedVersion) {
      emitStatus({ phase: 'downloaded', latestVersion: downloadedVersion })
      return
    }
    throw new Error(check.message ?? 'Échec de la vérification.')
  }
  if (check.status !== 'available' || !check.latestVersion) {
    throw new Error('Aucune mise à jour à télécharger — vous êtes à jour.')
  }
  if (downloadedVersion === check.latestVersion) {
    // This exact version is already on disk — straight to "ready to install".
    emitStatus({ phase: 'downloaded', latestVersion: downloadedVersion })
    return
  }

  downloading = true
  try {
    await autoUpdater.downloadUpdate()
    // 'update-downloaded' fires the 'downloaded' event; state settles there.
  } catch (e) {
    downloading = false
    throw new Error(`Échec du téléchargement : ${(e as Error)?.message ?? 'erreur inconnue'}.`)
  }
}

/**
 * Quit the app and run the downloaded update's installer VISIBLY (non-silent
 * NSIS UI), relaunching the app afterwards. Only valid once downloaded.
 */
export function installUpdateNow(): void {
  if (!downloadedVersion) {
    throw new Error('Aucune mise à jour téléchargée — lancez d’abord le téléchargement.')
  }
  // isSilent=false → the classic installer window shows; isForceRunAfter=true →
  // the app restarts once the installer finishes.
  autoUpdater.quitAndInstall(false, true)
}

/** Re-check interval while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 h

/**
 * Start the updater: wire events + a periodic availability CHECK (no download).
 * `emitter` pushes UPDATE_STATUS events to the renderer (toast + Réglages UI);
 * the renderer also pulls getUpdateState() on mount, which covers the startup
 * race where the first check finishes before React subscribes.
 */
export function initAutoUpdates(emitter: EventEmitterFn): void {
  emit = emitter
  if (!app.isPackaged || started) return
  started = true

  // The user drives everything: no background download, no install-on-quit.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    // Don't demote an ongoing/completed download of the SAME version; a newer
    // version showing up while one is downloaded should surface again.
    if (downloading) return
    if (downloadedVersion && !isVersionNewer(info.version, downloadedVersion)) return
    emitStatus({ phase: 'available', latestVersion: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    emitStatus({
      phase: 'downloading',
      latestVersion: lastStatus?.latestVersion,
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    downloadedVersion = info.version
    emitStatus({ phase: 'downloaded', latestVersion: info.version })
  })
  autoUpdater.on('error', (err) => {
    // Background check errors are noise (offline, rate limit); only surface
    // errors the user is waiting on (an accepted download).
    if (!downloading) return
    downloading = false
    emitStatus({ phase: 'error', message: err?.message ?? 'erreur inconnue' })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      // Best-effort: ignore network / no-release / rate-limit errors.
    })
  }

  check()
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  // Don't keep the event loop alive just for the update timer.
  timer.unref?.()
}
