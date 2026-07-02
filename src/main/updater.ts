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
 * Failures (offline, rate limit, no release yet) are swallowed or surfaced as
 * an 'error' event — they must never crash or block the app.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { EventContract, UpdateCheckOutcome, UpdateStatusEvent } from '@shared/index'
import { EventChannels } from '@shared/index'

/** Typed emitter shape (matches makeEmitter() in ipc/register.ts). */
type Emitter = <C extends keyof EventContract>(channel: C, payload: EventContract[C]) => void

let started = false
let emit: Emitter = () => {}
/** True between a user-accepted downloadUpdate() and its downloaded/error end. */
let downloading = false
/** Set once an update has fully downloaded (gates installUpdateNow). */
let downloaded = false

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

function emitStatus(e: Omit<UpdateStatusEvent, 'currentVersion'>): void {
  emit(EventChannels.UPDATE_STATUS, { currentVersion: app.getVersion(), ...e })
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
    if (latestVersion && isNewer(latestVersion, currentVersion)) {
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
 * via UPDATE_STATUS events. Throws (a plain Error) on immediate failure; async
 * failures surface as an 'error' event.
 */
export async function downloadUpdateNow(): Promise<void> {
  if (!app.isPackaged) throw new Error('Mises à jour inactives hors application installée.')
  if (downloading) return // already in flight; progress events keep the UI live
  if (downloaded) {
    emitStatus({ phase: 'downloaded' })
    return
  }
  // electron-updater requires a prior check in this session; do one defensively
  // (cheap, and guarantees the internal update info is primed).
  const check = await autoUpdater.checkForUpdates()
  const latest = check?.updateInfo?.version
  if (!latest || !isNewer(latest, app.getVersion())) {
    throw new Error('Aucune mise à jour à télécharger — vous êtes à jour.')
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
 * NSIS UI), relaunching the app afterwards. Only valid once 'downloaded'.
 */
export function installUpdateNow(): void {
  if (!downloaded) {
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
 * `emitter` pushes UPDATE_STATUS events to the renderer (toast + Réglages UI).
 */
export function initAutoUpdates(emitter: Emitter): void {
  emit = emitter
  if (!app.isPackaged || started) return
  started = true

  // The user drives everything: no background download, no install-on-quit.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    emitStatus({ phase: 'available', latestVersion: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    emitStatus({
      phase: 'downloading',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferredBytes: p.transferred,
      totalBytes: p.total
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    downloaded = true
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
