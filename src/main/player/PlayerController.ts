/**
 * PlayerController — Étape 4. Drives the real mpv binary to play either a
 * locally downloaded file or a live provider stream, exposing the typed player
 * IPC contract and pushing position/state events to the renderer.
 *
 * KEY DESIGN DECISIONS
 *
 * 1. Driving mpv: we talk to mpv over its JSON IPC channel directly (see
 *    MpvIpc) rather than via `node-mpv`. Direct socket control is the same code
 *    on Windows (named pipe) and POSIX (unix socket), needs no extra dependency,
 *    and gives precise control over the process lifecycle and property
 *    observation — which is what makes orphan-free, robust playback reliable.
 *
 * 2. Video surface: mpv is embedded into the app's main window via `--wid`
 *    (mpv attaches its video output to the supplied native window handle). On
 *    Electron/Windows this is the classic embedding approach: we pass the
 *    BrowserWindow's HWND so mpv renders over the `#mpv-surface` region of the
 *    renderer. If the window handle is unavailable, mpv falls back to its own
 *    window (still fully controllable over IPC). Visual layering/positioning
 *    can only be validated on the Windows target (no GUI/mpv here in WSL2).
 *
 * 3. Connection lock:
 *    - 'stream': acquires connectionLock.acquire('playback') BEFORE opening the
 *      provider URL, so download-engineer pauses its transfer (playback has
 *      priority). The lock is released on stop/error/end-of-file.
 *    - 'local': plays an on-disk file; it does NOT touch the connection lock
 *      (offline playback consumes no provider connection), so downloads may
 *      continue in parallel.
 *
 * 4. Lifecycle: exactly one mpv process at a time. Any new play() stops the
 *    previous session first. disposeForShutdown() is called on app quit /
 *    window close so no mpv process is ever orphaned.
 *
 * All handlers return PlayerStatus; errors are surfaced as PlayerState 'error'
 * (never thrown across IPC — the IPC layer wraps anything that does throw).
 */

import { spawn, type ChildProcess } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'

import type {
  EventContract,
  FullscreenRequest,
  PlayerState,
  PlayerStatus,
  PlayRequest,
  PlaySourceKind,
  SeekRequest,
  VolumeRequest
} from '@shared/index'
import { EventChannels } from '@shared/index'

import { connectionLock, type LockToken } from '../lock/ConnectionLock'
import { getXtreamClient } from '../xtream'
import { resolveMpvBinary } from './mpvBinary'
import { MpvIpc, type MpvEndFile, type MpvPropertyChange } from './mpvIpc'

/** Typed emitter shape (matches makeEmitter() in ipc/register.ts). */
export type PlayerEventEmitter = <C extends keyof EventContract>(
  channel: C,
  payload: EventContract[C]
) => void

/** Property observation ids (arbitrary, just need to be unique). */
const OBS = {
  timePos: 1,
  duration: 2,
  pause: 3,
  volume: 4,
  mute: 5,
  fullscreen: 6,
  eofReached: 7
} as const

/** ms between throttled position events to the renderer. */
const POSITION_THROTTLE_MS = 500

/** A typed error that maps to a clear PLAYER_ERROR for the renderer. */
export class PlayerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlayerError'
  }
}

export class PlayerController {
  private emit: PlayerEventEmitter = () => {}
  private getMainWindow: () => BrowserWindow | null = () => null

  private proc: ChildProcess | null = null
  private ipc: MpvIpc | null = null
  private lockToken: LockToken | null = null
  /** Monotonic session id; guards against late events from a killed session. */
  private sessionId = 0

  private status: PlayerStatus = idleStatus()
  private lastPositionEmit = 0

  /** Wire the typed emitter + a way to fetch the main window for `--wid`. */
  attach(emit: PlayerEventEmitter, getMainWindow: () => BrowserWindow | null): void {
    this.emit = emit
    this.getMainWindow = getMainWindow
  }

  /** Current snapshot of the player state. */
  getStatus(): PlayerStatus {
    return { ...this.status }
  }

  // ---------------------------------------------------------------- play()

  /**
   * Start playback of a local file or a provider stream. Any existing session
   * is stopped first (single mpv process). Returns the resulting status; on
   * failure the status carries state 'error' with a message.
   */
  async play(req: PlayRequest): Promise<PlayerStatus> {
    // Resolve the binary up-front so "mpv introuvable" is a clean error.
    const binary = resolveMpvBinary()
    if (!binary) {
      return this.toError(
        'Lecteur mpv introuvable. Le binaire mpv (resources/bin/win/mpv.exe) est ' +
          'absent et mpv n’est pas dans le PATH.'
      )
    }

    // Stop any previous session (releases its lock, kills its process).
    await this.stop()

    const session = ++this.sessionId
    this.setState('loading', { source: req.kind, title: req.title ?? null })

    let url: string
    try {
      url = await this.resolveSource(req)
    } catch (e) {
      return this.toError(describeError(e))
    }
    // A newer play() may have superseded us while resolving the URL.
    if (session !== this.sessionId) return this.getStatus()

    try {
      await this.spawnMpv(binary, url, req, session)
      return this.getStatus()
    } catch (e) {
      await this.teardown()
      return this.toError(describeError(e))
    }
  }

  /**
   * Resolve the media URL/path for the request. For 'stream' this acquires the
   * connection lock (playback priority) before returning the provider URL.
   */
  private async resolveSource(req: PlayRequest): Promise<string> {
    if (req.kind === 'local') {
      if (!req.filePath || req.filePath.trim() === '') {
        throw new PlayerError('Aucun fichier local fourni pour la lecture.')
      }
      // Local playback consumes no provider connection — do NOT take the lock.
      return req.filePath
    }

    // stream: acquire the single connection BEFORE opening the provider URL.
    if (typeof req.streamId !== 'number') {
      throw new PlayerError('streamId manquant pour la lecture en streaming.')
    }
    // Build the canonical (unsigned) movie URL from decrypted credentials.
    // mpv follows the 302 -> signed URL itself (we never cache the signed one).
    const client = getXtreamClient()
    const url = client.buildMovieUrl(req.streamId, req.containerExtension ?? 'mkv')
    await client.close().catch(() => undefined)

    // Playback priority: acquiring 'playback' makes download-engineer pause its
    // active transfer (it listens to the lock's busy changes).
    this.lockToken = await connectionLock.acquire('playback')
    return url
  }

  // ---------------------------------------------------------------- spawn

  private async spawnMpv(
    binary: string,
    url: string,
    req: PlayRequest,
    session: number
  ): Promise<void> {
    const ipcPath = makeIpcPath()
    const args = this.buildMpvArgs(ipcPath, url, req)

    const child = spawn(binary, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: false
    })
    this.proc = child

    child.on('error', (err) => {
      // Spawn-level failure (e.g. binary vanished) — only act on live session.
      if (session !== this.sessionId) return
      void this.teardown()
      this.toError(`Échec du lancement de mpv: ${err.message}`)
    })
    child.on('exit', (code) => {
      if (session !== this.sessionId) return
      // mpv exited on its own (user closed window, crash, codec abort).
      void this.handleExit(code)
    })

    // Connect to mpv's IPC endpoint (created shortly after spawn).
    const ipc = new MpvIpc(ipcPath)
    this.ipc = ipc
    try {
      await ipc.connect(8000)
    } catch (e) {
      throw new PlayerError(
        `Connexion au moteur mpv impossible: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    if (session !== this.sessionId) return

    this.wireIpc(ipc, req.kind, session)
    await this.observeProperties(ipc)

    // Apply optional start position (resume).
    if (typeof req.startSecs === 'number' && req.startSecs > 0) {
      await ipc.command(['seek', req.startSecs, 'absolute']).catch(() => undefined)
    }

    // We don't flip to 'playing' here; the pause property observer drives the
    // authoritative playing/paused state once mpv starts decoding.
  }

  /** Compose mpv CLI args: idle control mode + embedded surface + tuned output. */
  private buildMpvArgs(ipcPath: string, url: string, _req: PlayRequest): string[] {
    const args = [
      `--input-ipc-server=${ipcPath}`,
      '--idle=yes', // stay alive between files / after end-file
      '--force-window=yes', // ensure a render surface exists immediately
      '--keep-open=yes', // don't quit at end-of-file; we control teardown
      '--osc=no', // our renderer draws the chrome
      '--input-default-bindings=no',
      '--no-terminal',
      // Network resilience for streaming sources.
      '--network-timeout=30',
      '--user-agent=tv2026',
      // Subtitles: prefer embedded tracks, auto-select.
      '--sub-auto=fuzzy',
      url
    ]

    // Embed mpv's video output into the app window (Windows: HWND via --wid).
    const wid = this.nativeWindowId()
    if (wid !== null) {
      args.splice(1, 0, `--wid=${wid}`)
    }
    return args
  }

  /**
   * The native window handle to embed mpv into, as the integer mpv's --wid
   * expects. On Windows getNativeWindowHandle() returns an 8-byte buffer
   * holding the HWND pointer. Returns null if unavailable (mpv then opens its
   * own window, still IPC-controlled).
   */
  private nativeWindowId(): number | string | null {
    try {
      const win = this.getMainWindow()
      if (!win || win.isDestroyed()) return null
      const handle = win.getNativeWindowHandle()
      if (handle.length === 8) {
        // 64-bit pointer (Windows x64 HWND / X11 returns smaller — handled below).
        return handle.readBigUInt64LE().toString()
      }
      if (handle.length === 4) {
        return handle.readUInt32LE(0)
      }
      return null
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- IPC wiring

  private wireIpc(ipc: MpvIpc, source: PlaySourceKind, session: number): void {
    ipc.on('property-change', (change: MpvPropertyChange) => {
      if (session !== this.sessionId) return
      this.onPropertyChange(change)
    })
    ipc.on('end-file', (e: MpvEndFile) => {
      if (session !== this.sessionId) return
      this.onEndFile(e)
    })
    ipc.on('close', () => {
      // IPC dropped without an exit handler firing first — treat as ended.
      if (session !== this.sessionId) return
      void this.handleExit(null)
    })
    ipc.on('error', () => {
      // Logged at the socket level; non-fatal. Genuine drops surface as 'close'.
    })
    void source
  }

  private async observeProperties(ipc: MpvIpc): Promise<void> {
    await Promise.all([
      ipc.observeProperty(OBS.timePos, 'time-pos'),
      ipc.observeProperty(OBS.duration, 'duration'),
      ipc.observeProperty(OBS.pause, 'pause'),
      ipc.observeProperty(OBS.volume, 'volume'),
      ipc.observeProperty(OBS.mute, 'mute'),
      ipc.observeProperty(OBS.fullscreen, 'fullscreen'),
      ipc.observeProperty(OBS.eofReached, 'eof-reached')
    ]).catch(() => undefined)
  }

  private onPropertyChange(change: MpvPropertyChange): void {
    switch (change.name) {
      case 'time-pos': {
        const pos = asNumber(change.data)
        if (pos !== null) {
          this.status.positionSecs = pos
          this.maybeEmitPosition()
        }
        break
      }
      case 'duration': {
        const dur = asNumber(change.data)
        this.status.durationSecs = dur !== null && dur > 0 ? dur : null
        break
      }
      case 'pause': {
        const paused = change.data === true
        // Only meaningful once we're out of loading.
        if (this.status.state === 'loading') {
          this.setState(paused ? 'paused' : 'playing')
        } else if (this.status.state === 'playing' || this.status.state === 'paused') {
          this.setState(paused ? 'paused' : 'playing')
        }
        break
      }
      case 'volume': {
        const v = asNumber(change.data)
        if (v !== null) this.status.volume = clampVolume(v)
        break
      }
      case 'mute': {
        this.status.muted = change.data === true
        break
      }
      case 'fullscreen': {
        this.status.fullscreen = change.data === true
        break
      }
      case 'eof-reached': {
        if (change.data === true) this.onEndFile({ reason: 'eof' })
        break
      }
    }
  }

  private onEndFile(e: MpvEndFile): void {
    // 'eof' = natural end; 'error' = decode/network failure; others = stop/quit.
    if (e.reason === 'error') {
      void this.teardown()
      this.toError('Erreur de lecture mpv (codec ou réseau).')
      return
    }
    if (e.reason === 'eof') {
      this.setState('ended')
      // Free the connection; the file is done.
      void this.teardown()
    }
    // 'stop'/'quit'/'redirect' are handled by stop()/exit paths.
  }

  private async handleExit(code: number | null): Promise<void> {
    // mpv process gone. If it ended cleanly we keep 'ended'; otherwise error
    // unless we're already idle (a stop() we initiated).
    const wasError = code !== null && code !== 0
    await this.teardown()
    if (this.status.state === 'ended' || this.status.state === 'idle') {
      this.setState('idle')
    } else if (wasError) {
      this.toError(`mpv s’est arrêté (code ${code}).`)
    } else {
      this.setState('idle')
    }
  }

  // ---------------------------------------------------------------- controls

  async pause(): Promise<PlayerStatus> {
    await this.ipc?.setProperty('pause', true).catch(() => undefined)
    if (this.status.state === 'playing') this.setState('paused')
    return this.getStatus()
  }

  async resume(): Promise<PlayerStatus> {
    await this.ipc?.setProperty('pause', false).catch(() => undefined)
    if (this.status.state === 'paused') this.setState('playing')
    return this.getStatus()
  }

  async seek(req: SeekRequest): Promise<PlayerStatus> {
    if (!this.ipc?.isConnected()) return this.getStatus()
    const pos = Math.max(0, req.positionSecs)
    await this.ipc.command(['seek', pos, 'absolute']).catch(() => undefined)
    this.status.positionSecs = pos
    return this.getStatus()
  }

  async setVolume(req: VolumeRequest): Promise<PlayerStatus> {
    if (this.ipc?.isConnected()) {
      await this.ipc.setProperty('volume', clampVolume(req.volume)).catch(() => undefined)
      if (typeof req.muted === 'boolean') {
        await this.ipc.setProperty('mute', req.muted).catch(() => undefined)
      }
    }
    this.status.volume = clampVolume(req.volume)
    if (typeof req.muted === 'boolean') this.status.muted = req.muted
    return this.getStatus()
  }

  async setFullscreen(req: FullscreenRequest): Promise<PlayerStatus> {
    await this.ipc?.setProperty('fullscreen', req.fullscreen).catch(() => undefined)
    this.status.fullscreen = req.fullscreen
    return this.getStatus()
  }

  /**
   * Stop playback: kill mpv, release the connection lock, reset to idle.
   * Safe to call when nothing is playing.
   */
  async stop(): Promise<PlayerStatus> {
    if (!this.proc && !this.ipc && !this.lockToken) {
      // Nothing active; ensure idle.
      if (this.status.state !== 'idle') this.setState('idle')
      return this.getStatus()
    }
    // Invalidate the session so in-flight events from this mpv are ignored.
    this.sessionId++
    await this.teardown()
    this.setState('idle', { source: null, title: null })
    return this.getStatus()
  }

  /** Kill mpv + release lock without changing the public state (internal). */
  private async teardown(): Promise<void> {
    const ipc = this.ipc
    const proc = this.proc
    this.ipc = null
    this.proc = null

    if (ipc) {
      // Ask mpv to quit gracefully, then dispose the socket.
      await ipc.command(['quit']).catch(() => undefined)
      ipc.dispose()
    }
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill()
      // Hard-kill fallback if it lingers.
      setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
      }, 1500)
    }
    if (this.lockToken) {
      connectionLock.release(this.lockToken)
      this.lockToken = null
    }
  }

  /**
   * Tear everything down on app shutdown / window close. Never leaves an orphan
   * mpv process. Called from main/index.ts before-quit + window close.
   */
  disposeForShutdown(): void {
    this.sessionId++
    const proc = this.proc
    this.ipc?.dispose()
    this.ipc = null
    this.proc = null
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill()
      // Synchronous best-effort hard kill on quit.
      try {
        proc.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
    if (this.lockToken) {
      connectionLock.release(this.lockToken)
      this.lockToken = null
    }
    this.status = idleStatus()
  }

  // ---------------------------------------------------------------- state/events

  private setState(state: PlayerState, patch?: Partial<PlayerStatus>): void {
    this.status = { ...this.status, state, ...patch }
    if (state !== 'error') this.status.error = undefined
    this.emit(EventChannels.PLAYER_STATE, {
      state,
      error: state === 'error' ? this.status.error : undefined
    })
    // Always push a position tick alongside a state change so the UI syncs.
    this.emitPosition(true)
  }

  private toError(message: string): PlayerStatus {
    this.status = { ...this.status, state: 'error', error: message }
    this.emit(EventChannels.PLAYER_STATE, { state: 'error', error: message })
    this.emitPosition(true)
    return this.getStatus()
  }

  private maybeEmitPosition(): void {
    const now = Date.now()
    if (now - this.lastPositionEmit < POSITION_THROTTLE_MS) return
    this.emitPosition(false)
  }

  private emitPosition(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastPositionEmit < POSITION_THROTTLE_MS) return
    this.lastPositionEmit = now
    this.emit(EventChannels.PLAYER_POSITION, {
      positionSecs: this.status.positionSecs,
      durationSecs: this.status.durationSecs,
      state: this.status.state
    })
  }
}

/** Singleton shared across the main process. */
export const playerController = new PlayerController()

// ----------------------------------------------------------------- helpers

function idleStatus(): PlayerStatus {
  return {
    state: 'idle',
    positionSecs: 0,
    durationSecs: null,
    volume: 100,
    muted: false,
    fullscreen: false,
    source: null,
    title: null
  }
}

/** Per-session mpv IPC endpoint: named pipe on Windows, unix socket elsewhere. */
function makeIpcPath(): string {
  const name = `tv2026-mpv-${process.pid}-${Date.now()}`
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${name}`
  }
  return join(tmpdir(), `${name}.sock`)
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function clampVolume(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function describeError(e: unknown): string {
  if (e instanceof PlayerError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
