/**
 * RecordingController — headless scheduled recording of a live channel.
 *
 * Distinct from the interactive PlayerController: it spawns mpv with
 * `--stream-dump=<file>` (raw stream copy, NO window, NO decode) for the live
 * URL and kills the process when the recording window ends. One recording at a
 * time (single provider connection).
 *
 * Connection model (mirrors PlayerController):
 *  - A recording acquires connectionLock.acquire('playback') — same priority
 *    tier as live playback — so the DownloadManager pauses its transfer while we
 *    record (recording has priority over downloads).
 *  - vs PLAYBACK: only one 'playback'-tier holder makes sense at a time. The
 *    SCHEDULER decides the conflict (ASK the user) BEFORE calling start(); by the
 *    time start() runs, playback is expected to be stopped. start() takes the
 *    lock non-blockingly and fails if it cannot (so we never silently queue).
 *
 * The file path is built + confined by the caller (handler/scheduler) exactly
 * like the interactive PLAYER_START_RECORDING handler (sanitized name inside the
 * Live subfolder, asserted within the download dir).
 */

import { spawn, type ChildProcess } from 'child_process'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'

import { connectionLock, type LockToken } from '../lock/ConnectionLock'
import { getXtreamClient } from '../xtream'
import { resolveMpvBinary } from './mpvBinary'

/** A typed error so the scheduler can map a failure to a clear status. */
export class RecordingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordingError'
  }
}

interface ActiveRecording {
  reminderId: number
  proc: ChildProcess
  token: LockToken
  filePath: string
}

export class RecordingController {
  private active: ActiveRecording | null = null

  /** Whether a headless recording is currently running. */
  isRecording(): boolean {
    return this.active !== null
  }

  /** The reminder id of the in-progress recording, or null. */
  currentReminderId(): number | null {
    return this.active?.reminderId ?? null
  }

  /**
   * Start dumping the live channel `streamId` to `filePath`. Takes the single
   * connection (playback tier → downloads pause). Throws RecordingError if mpv
   * is missing, the lock is busy (playback in progress and not yet resolved), or
   * a recording is already running.
   *
   * `onExit` fires once when the process ends (clean stop or crash) with whether
   * it looked successful — the scheduler uses it to finalize status.
   */
  async start(opts: {
    reminderId: number
    streamId: number
    ext?: string
    filePath: string
    onExit: (info: { ok: boolean; code: number | null }) => void
  }): Promise<void> {
    if (this.active) {
      throw new RecordingError('Un enregistrement est déjà en cours.')
    }
    const binary = resolveMpvBinary()
    if (!binary) {
      throw new RecordingError(
        'Lecteur mpv introuvable pour l’enregistrement (binaire absent et hors PATH).'
      )
    }

    // Build the canonical (unsigned) live URL. mpv follows the 302 itself; we
    // never cache or log the signed URL.
    const client = getXtreamClient()
    const url = client.buildLiveUrl(opts.streamId, opts.ext ?? 'ts')
    await client.close().catch(() => undefined)

    // Take the single connection without blocking. The scheduler resolves any
    // playback conflict (ASK the user) BEFORE calling start(), so by now the
    // connection should be free; if not, fail loudly rather than queue forever.
    const token = connectionLock.tryAcquire('playback')
    if (!token) {
      throw new RecordingError('La connexion est occupée ; enregistrement impossible.')
    }

    try {
      await mkdir(dirname(opts.filePath), { recursive: true })
    } catch (e) {
      connectionLock.release(token)
      throw new RecordingError(
        `Impossible de créer le dossier d’enregistrement : ${(e as Error).message}`
      )
    }

    // Headless raw stream copy: no window, no decode, just dump bytes to .ts.
    const args = [
      '--no-terminal',
      '--no-video',
      '--no-audio',
      `--stream-dump=${opts.filePath}`,
      '--network-timeout=30',
      '--user-agent=tv2026',
      url
    ]
    const child = spawn(binary, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true
    })
    this.active = { reminderId: opts.reminderId, proc: child, token, filePath: opts.filePath }

    const finalize = (code: number | null): void => {
      // Only act if this is still the active recording (guards double events).
      if (!this.active || this.active.proc !== child) return
      const wasActive = this.active
      this.active = null
      connectionLock.release(wasActive.token)
      // We kill mpv to stop a dump, so a non-zero/SIGTERM exit on a deliberate
      // stop is normal; the scheduler decides ok-ness by whether it asked to stop.
      opts.onExit({ ok: code === 0, code })
    }

    child.on('error', (err) => {
      if (!this.active || this.active.proc !== child) return
      const wasActive = this.active
      this.active = null
      connectionLock.release(wasActive.token)
      opts.onExit({ ok: false, code: null })
      console.error('[RecordingController] mpv spawn error', err.message)
    })
    child.on('exit', (code) => finalize(code))
  }

  /**
   * Stop the in-progress recording for `reminderId` (no-op if it's not the
   * active one). Kills mpv; the exit handler releases the lock + fires onExit.
   */
  stop(reminderId: number): void {
    if (!this.active || this.active.reminderId !== reminderId) return
    this.killActive()
  }

  /** Stop whatever is recording (used on shutdown / conflict switch). */
  stopAny(): void {
    if (this.active) this.killActive()
  }

  private killActive(): void {
    const proc = this.active?.proc
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill()
      setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
      }, 1500)
    }
  }

  /**
   * Tear down on app shutdown without firing onExit (the app is going away).
   * Releases the lock so connectionLock.reset() has nothing dangling.
   */
  disposeForShutdown(): void {
    const wasActive = this.active
    this.active = null
    if (wasActive) {
      const proc = wasActive.proc
      if (proc && proc.exitCode === null && !proc.killed) {
        proc.kill()
        try {
          proc.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
      connectionLock.release(wasActive.token)
    }
  }
}

/** Singleton shared across the main process. */
export const recordingController = new RecordingController()
