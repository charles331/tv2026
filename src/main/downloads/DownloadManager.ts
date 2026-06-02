/**
 * DownloadManager — the real download engine (Étape 3, the heart of the app).
 *
 * Responsibilities (see ARCHITECTURE.md + agent brief):
 *  - Stream a movie file to disk via undici with backpressure (never buffer a
 *    multi-GB file in memory).
 *  - Write to a `<final>.part` temp file, then atomically rename to the final
 *    name on completion.
 *  - Resume an interrupted `.part` with `Range: bytes=<received>-`, validating
 *    the server's `206` / `Content-Range`; fall back to a clean restart if the
 *    server refuses the range.
 *  - Strictly sequential queue (one active transfer at a time) honoring the
 *    single-connection ConnectionLock. Playback has priority: when the player
 *    takes the lock, the active download pauses and resumes afterwards.
 *  - Emit `event:download:progress` (bytes, %, instantaneous + average speed,
 *    ETA) and `event:download:state` (state transitions) to the renderer.
 *  - pause / resume / cancel / reorder; the queue + per-item progress live in
 *    SQLite (downloadsRepo) so a restart resumes exactly where it left off.
 *  - Re-resolve the movie URL via buildMovieUrl on every (re)start — the signed
 *    302 target expires and is NEVER persisted.
 *
 * All SQL goes through downloadsRepo; this module never touches SQLite directly.
 */

import { createWriteStream } from 'fs'
import { rename, stat, statfs, unlink, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import type { Readable } from 'stream'
import { Agent, interceptors, request, type Dispatcher } from 'undici'

import type {
  DownloadItem,
  DownloadProgressEvent,
  DownloadStateEvent,
  DownloadStatus,
  EventContract
} from '@shared/index'
import { EventChannels } from '@shared/index'

import { downloadsRepo } from '../store'
import { connectionLock, type LockToken } from '../lock/ConnectionLock'
import { getXtreamClient } from '../xtream'
import {
  HttpStatusError,
  partPath,
  headerValue,
  parseContentRangeTotal,
  describeError,
  formatBytes
} from './helpers'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tv2026/0.1 Safari/537.36'

/** ms between throttled progress events to the renderer. */
const PROGRESS_THROTTLE_MS = 500
/** Safety margin required on top of the remaining bytes before starting. */
const DISK_SPACE_MARGIN_BYTES = 64 * 1024 * 1024 // 64 MiB

/**
 * Dedicated dispatcher for movie transfers. Unlike the metadata client (short
 * body timeout), large files trickle for a long time, so bodyTimeout is
 * generous. The redirect interceptor transparently follows the 302 → signed
 * backend URL while carrying the Range header through. We never inspect or
 * cache that signed URL.
 */
function makeDownloadDispatcher(): Agent {
  return new Agent({
    headersTimeout: 30_000,
    // Time between received body chunks before timing out. 60s tolerates stalls
    // without hanging forever on a dead socket.
    bodyTimeout: 60_000,
    connect: { timeout: 30_000 }
  })
}

/**
 * Test hook: cap the number of bytes a single transfer will pull before it
 * cleanly stops (as if paused). Used ONLY by the resume test harness so we
 * never download a full ~5 GB file. `null` = unlimited (normal behaviour).
 */
let testByteCap: number | null = null
export function __setTestByteCap(bytes: number | null): void {
  testByteCap = bytes
}

/**
 * Typed event emitter, matching the shape returned by `makeEmitter` in
 * ipc/register.ts. We only ever emit the two download channels.
 */
export type DownloadEventEmitter = <C extends keyof EventContract>(
  channel: C,
  payload: EventContract[C]
) => void

/** Raised internally to abort the active transfer for a known reason. */
class TransferInterrupt extends Error {
  constructor(
    readonly reason: 'paused' | 'canceled' | 'playback' | 'shutdown'
  ) {
    super(`transfer interrupted: ${reason}`)
    this.name = 'TransferInterrupt'
  }
}

interface ActiveTransfer {
  id: number
  controller: AbortController
  /** Why we are aborting, set just before controller.abort(). */
  interruptReason: TransferInterrupt['reason'] | null
}

export class DownloadManager {
  private emit: DownloadEventEmitter = () => {}
  private active: ActiveTransfer | null = null
  /** True while the queue loop is draining; prevents concurrent loops. */
  private looping = false
  private started = false
  /**
   * Set when playback is preempting / holds the connection. While true the queue
   * loop will not start a new transfer, so playback wins the single connection.
   * Set by onPreemptRequested (playback queued behind us) and cleared by
   * onBusyChange when playback finally releases the lock.
   */
  private playbackActive = false
  private unsubscribeBusy: (() => void) | null = null
  private unsubscribePreempt: (() => void) | null = null

  /** Wire the typed event emitter (called once from main/index.ts). */
  attachEmitter(emit: DownloadEventEmitter): void {
    this.emit = emit
  }

  /**
   * Begin operating: reconcile persisted state, subscribe to lock changes for
   * playback priority, and kick the queue. Safe to call once at startup.
   */
  start(): void {
    if (this.started) return
    this.started = true

    // PREEMPTION (the effective playback-priority mechanism). Fires the moment a
    // higher-priority holder (playback) is queued behind our in-progress
    // download — i.e. exactly the case onBusyChange does NOT cover, because the
    // lock holder hasn't changed yet. On 'download' we mark playback active and
    // interrupt the active transfer with reason 'playback'. interruptActive is
    // idempotent, so repeated/duplicate signals are no-ops. The transfer aborts,
    // runItem's finally release()s our token, and the FIFO lock is handed to the
    // waiting player. The interrupted item returns to 'queued' (see
    // handleTransferError) so it resumes via Range after playback ends.
    this.unsubscribePreempt = connectionLock.onPreemptRequested((holderToYield) => {
      if (holderToYield !== 'download') return
      this.playbackActive = true
      this.interruptActive('playback')
    })

    // Busy-state is used for two non-preemption purposes:
    //  - mark playbackActive while the player actually holds the connection, so
    //    the queue loop won't start a new transfer underneath it;
    //  - detect when playback releases the lock, to re-kick the queue.
    this.unsubscribeBusy = connectionLock.onBusyChange((state) => {
      const playbackNow = state.busy && state.reason === 'playback'
      if (playbackNow) {
        this.playbackActive = true
      } else if (this.playbackActive && !playbackNow) {
        // Player released (or never held) the lock — resume draining the queue.
        this.playbackActive = false
        void this.kick()
      }
    })

    void this.kick()
  }

  /** Tear down listeners and abort any active transfer (graceful shutdown). */
  stop(): void {
    this.unsubscribePreempt?.()
    this.unsubscribePreempt = null
    this.unsubscribeBusy?.()
    this.unsubscribeBusy = null
    this.interruptActive('shutdown')
    this.started = false
  }

  // ---------------------------------------------------------------- queue API

  list(): DownloadItem[] {
    return downloadsRepo.listDownloads()
  }

  /**
   * Enqueue a new download. The destination filename is sanitized for Windows.
   * Persists the queue row and kicks the loop.
   */
  add(opts: {
    streamId: number
    name: string
    containerExtension: string
    fileName: string
    destPath: string
  }): DownloadItem {
    const item = downloadsRepo.addDownload({
      streamId: opts.streamId,
      name: opts.name,
      fileName: opts.fileName,
      destPath: opts.destPath,
      containerExtension: opts.containerExtension
    })
    this.emitState(item.id, item.streamId, 'queued')
    void this.kick()
    return item
  }

  pause(id: number): DownloadItem | null {
    const item = downloadsRepo.getDownload(id)
    if (!item) return null
    if (this.active?.id === id) {
      // Active transfer: abort; the loop persists 'paused' and releases the lock.
      this.interruptActive('paused')
    } else if (item.status === 'queued' || item.status === 'downloading') {
      downloadsRepo.updateStatus(id, 'paused')
      this.emitState(id, item.streamId, 'paused')
    }
    return downloadsRepo.getDownload(id)
  }

  resume(id: number): DownloadItem | null {
    const item = downloadsRepo.getDownload(id)
    if (!item) return null
    if (item.status === 'paused' || item.status === 'failed') {
      downloadsRepo.updateStatus(id, 'queued', null)
      this.emitState(id, item.streamId, 'queued')
      void this.kick()
    }
    return downloadsRepo.getDownload(id)
  }

  cancel(id: number): DownloadItem | null {
    const item = downloadsRepo.getDownload(id)
    if (!item) return null
    if (this.active?.id === id) {
      // Abort active transfer; the loop finalizes the cancel + cleans the .part.
      this.interruptActive('canceled')
    } else {
      downloadsRepo.updateStatus(id, 'canceled')
      this.emitState(id, item.streamId, 'canceled')
      // Best-effort cleanup of any partial file for a non-active item.
      void unlink(partPath(item.destPath)).catch(() => undefined)
    }
    return downloadsRepo.getDownload(id)
  }

  reorder(orderedIds: number[]): DownloadItem[] {
    const out = downloadsRepo.reorder(orderedIds)
    void this.kick()
    return out
  }

  clearCompleted(): number {
    return downloadsRepo.clearFinished()
  }

  // -------------------------------------------------------------- queue engine

  /** Abort the active transfer, recording the reason so the loop reacts. */
  private interruptActive(reason: TransferInterrupt['reason']): void {
    if (this.active && !this.active.interruptReason) {
      this.active.interruptReason = reason
      this.active.controller.abort()
    }
  }

  /** Pick the next queued item (lowest queue_position) ready to run. */
  private nextQueued(): DownloadItem | null {
    const items = downloadsRepo.listDownloads()
    return items.find((i) => i.status === 'queued') ?? null
  }

  /**
   * Drain the queue sequentially. Re-entrant-safe: only one loop runs at a time.
   * Stops when there is nothing queued or playback owns the connection.
   */
  private async kick(): Promise<void> {
    if (this.looping) return
    this.looping = true
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.playbackActive || connectionLock.current() === 'playback') return
        const next = this.nextQueued()
        if (!next) return
        await this.runItem(next)
      }
    } finally {
      this.looping = false
    }
  }

  /**
   * Run a single item end-to-end under the ConnectionLock. Handles disk-space
   * pre-check, transfer, resume validation, atomic rename, and all terminal
   * states. Never throws; records 'failed' on unexpected errors.
   */
  private async runItem(item: DownloadItem): Promise<void> {
    // Re-read fresh state (it may have been paused/canceled between selection
    // and now) and mark downloading optimistically only after acquiring lock.
    let token: LockToken | null = null
    const controller = new AbortController()
    this.active = { id: item.id, controller, interruptReason: null }

    try {
      // Free-space pre-check (best effort; refuse if clearly insufficient).
      const spaceErr = await this.checkDiskSpace(item)
      if (spaceErr) {
        this.fail(item, spaceErr)
        return
      }

      token = await connectionLock.acquire('download')

      // While we waited for the lock, the user may have paused/canceled this
      // item or playback may have been requested. Honor that before opening a
      // connection, then release the lock for the next holder.
      const pending = this.active.interruptReason
      if (pending === 'playback' || this.playbackActive) {
        downloadsRepo.updateStatus(item.id, 'queued')
        return
      }
      if (pending === 'paused') {
        downloadsRepo.updateStatus(item.id, 'paused')
        this.emitState(item.id, item.streamId, 'paused')
        return
      }
      if (pending === 'canceled') {
        downloadsRepo.updateStatus(item.id, 'canceled')
        this.emitState(item.id, item.streamId, 'canceled')
        await unlink(partPath(item.destPath)).catch(() => undefined)
        downloadsRepo.archiveToHistory(item.id, 'canceled')
        return
      }

      downloadsRepo.updateStatus(item.id, 'downloading', null)
      this.emitState(item.id, item.streamId, 'downloading')

      await this.transfer(item)
    } catch (e) {
      await this.handleTransferError(item, e)
    } finally {
      if (token) connectionLock.release(token)
      this.active = null
    }
  }

  /**
   * Resolve URL (fresh, never persisted), open the stream with Range when a
   * `.part` exists, validate the response, and pipe to disk with backpressure.
   */
  private async transfer(item: DownloadItem): Promise<void> {
    // Re-resolve the canonical movie URL on every (re)start — the signed 302
    // target expires and is NEVER persisted.
    const client = getXtreamClient()
    const url = client.buildMovieUrl(item.streamId, item.containerExtension)
    // The client is only used to build the URL from decrypted credentials; the
    // transfer uses its own redirect-following dispatcher.
    await client.close().catch(() => undefined)

    const agent = makeDownloadDispatcher()
    const dispatcher: Dispatcher = agent.compose(
      interceptors.redirect({ maxRedirections: 5 })
    )

    try {
      const dest = item.destPath
      const part = partPath(dest)
      await mkdir(dirname(dest), { recursive: true })

      // How many bytes are already on disk in the .part file?
      let resumeFrom = await fileSizeOrZero(part)

      // Sanity: if the DB says we received more/less than the .part, trust disk.
      if (resumeFrom !== item.receivedBytes) {
        downloadsRepo.updateProgress(item.id, resumeFrom, item.totalBytes)
      }

      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: '*/*'
      }
      if (resumeFrom > 0) headers['range'] = `bytes=${resumeFrom}-`

      // Redirect following is handled by the composed redirect interceptor on
      // `dispatcher`, so the 302 -> signed backend URL is transparent and the
      // Range header carries through. We never inspect/cache the signed URL.
      const res = await request(url, {
        method: 'GET',
        dispatcher,
        headers,
        signal: this.active!.controller.signal
      })

      // ---- validate the response & decide append vs restart ----
      let appendMode = false
      let totalBytes: number | null = item.totalBytes

      if (resumeFrom > 0) {
        if (res.statusCode === 206) {
          // Server honored the range. Derive total from Content-Range.
          const cr = headerValue(res.headers['content-range'])
          const totalFromRange = parseContentRangeTotal(cr)
          if (totalFromRange !== null) totalBytes = totalFromRange
          appendMode = true
        } else if (res.statusCode === 200) {
          // Server refused the range (sent the whole file). Clean restart.
          await res.body.dump().catch(() => undefined)
          await unlink(part).catch(() => undefined)
          resumeFrom = 0
          downloadsRepo.updateProgress(item.id, 0, null)
          return await this.transfer(downloadsRepo.getDownload(item.id) ?? item)
        } else {
          await res.body.dump().catch(() => undefined)
          throw new HttpStatusError(res.statusCode)
        }
      } else {
        if (res.statusCode === 200 || res.statusCode === 206) {
          const len = headerValue(res.headers['content-length'])
          const n = len ? Number(len) : NaN
          totalBytes = Number.isFinite(n) && n > 0 ? n : item.totalBytes
          // A 206 on a fresh start would have Content-Range too.
          if (res.statusCode === 206) {
            const cr = headerValue(res.headers['content-range'])
            const totalFromRange = parseContentRangeTotal(cr)
            if (totalFromRange !== null) totalBytes = totalFromRange
          }
          appendMode = false
        } else {
          await res.body.dump().catch(() => undefined)
          throw new HttpStatusError(res.statusCode)
        }
      }

      downloadsRepo.updateProgress(item.id, resumeFrom, totalBytes)

      // ---- pipe to disk with backpressure + progress accounting ----
      const out = createWriteStream(part, { flags: appendMode ? 'a' : 'w' })
      let received = resumeFrom
      const startedAt = Date.now()
      let lastEmit = 0
      let lastBytes = resumeFrom
      let lastSpeedTs = startedAt

      // A counting passthrough preserves backpressure (pipeline drives it) while
      // letting us account bytes and throttle progress events.
      const counter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          received += chunk.length
          // Test-only short-range cap: stop cleanly, simulating a pause.
          if (testByteCap !== null && received - resumeFrom >= testByteCap) {
            this.interruptActive('paused')
          }
          const now = Date.now()
          if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
            const dt = (now - lastSpeedTs) / 1000
            const instBps = dt > 0 ? (received - lastBytes) / dt : 0
            const avgBps =
              (received - resumeFrom) / Math.max(0.001, (now - startedAt) / 1000)
            const remaining = totalBytes ? totalBytes - received : null
            const etaSecs =
              remaining !== null && avgBps > 0 ? Math.round(remaining / avgBps) : null
            downloadsRepo.updateProgress(item.id, received, totalBytes)
            this.emitProgress(item, received, totalBytes, Math.round(instBps), etaSecs)
            lastEmit = now
            lastBytes = received
            lastSpeedTs = now
          }
          cb(null, chunk)
        }
      })

      const body = res.body as unknown as Readable

      try {
        await pipeline(body, counter, out, {
          signal: this.active!.controller.signal
        })
      } catch (e) {
        // Persist whatever we wrote before re-throwing so resume is exact.
        downloadsRepo.updateProgress(item.id, await fileSizeOrZero(part), totalBytes)
        throw e
      }

      // Final flush of progress.
      received = await fileSizeOrZero(part)
      downloadsRepo.updateProgress(item.id, received, totalBytes)

      // If we stopped because of an interrupt (incl. test cap), don't complete.
      if (this.active?.interruptReason) {
        throw new TransferInterrupt(this.active.interruptReason)
      }

      // ---- complete: atomic rename .part -> final ----
      await rename(part, dest)
      downloadsRepo.updateStatus(item.id, 'completed')
      this.emitState(item.id, item.streamId, 'completed', { destPath: dest })
      downloadsRepo.archiveToHistory(item.id, 'completed')
    } finally {
      await agent.close().catch(() => undefined)
    }
  }

  /** Map a transfer error/abort to the right terminal or paused state. */
  private async handleTransferError(item: DownloadItem, e: unknown): Promise<void> {
    const reason = this.active?.interruptReason ?? null

    // The lock was reset (graceful shutdown) while we waited to acquire it. Keep
    // the item queued and the .part intact so it resumes via Range next launch —
    // never mark it failed.
    if (e instanceof Error && e.name === 'LockResetError') {
      downloadsRepo.updateStatus(item.id, 'queued')
      return
    }

    const isAbort =
      reason !== null ||
      (e instanceof Error && (e.name === 'AbortError' || e.name === 'TransferInterrupt'))

    if (isAbort) {
      switch (reason) {
        case 'canceled': {
          downloadsRepo.updateStatus(item.id, 'canceled')
          this.emitState(item.id, item.streamId, 'canceled')
          await unlink(partPath(item.destPath)).catch(() => undefined)
          downloadsRepo.archiveToHistory(item.id, 'canceled')
          return
        }
        case 'shutdown':
        case 'playback':
        case 'paused':
        default: {
          // Keep the .part for resume; mark paused (playback) or queued.
          const back: DownloadStatus = reason === 'playback' ? 'queued' : 'paused'
          downloadsRepo.updateStatus(item.id, back)
          this.emitState(item.id, item.streamId, back)
          return
        }
      }
    }

    // Genuine failure (network drop, token expiry, disk full, etc.).
    const msg = describeError(e)
    this.fail(item, msg)
  }

  private fail(item: DownloadItem, message: string): void {
    downloadsRepo.updateStatus(item.id, 'failed', message)
    this.emitState(item.id, item.streamId, 'failed', { error: message })
  }

  /**
   * Refuse to start if free space can't cover the remaining bytes (+ margin).
   * Returns an error message when insufficient, otherwise null. Best effort:
   * if the total is unknown or statfs fails, we allow the start.
   */
  private async checkDiskSpace(item: DownloadItem): Promise<string | null> {
    const total = item.totalBytes
    if (!total || total <= 0) return null
    const part = partPath(item.destPath)
    const onDisk = await fileSizeOrZero(part)
    const remaining = Math.max(0, total - onDisk)
    const needed = remaining + DISK_SPACE_MARGIN_BYTES
    try {
      const fsStat = await statfs(dirname(item.destPath))
      const free = fsStat.bavail * fsStat.bsize
      if (free < needed) {
        return `Not enough free disk space: need ~${formatBytes(needed)}, only ${formatBytes(
          free
        )} available.`
      }
    } catch {
      // statfs unavailable (e.g. odd FS) — don't block the download.
      return null
    }
    return null
  }

  // ----------------------------------------------------------------- emitters

  private emitProgress(
    item: DownloadItem,
    received: number,
    total: number | null,
    speedBps: number,
    etaSecs: number | null
  ): void {
    const progress = total && total > 0 ? Math.min(1, received / total) : null
    const payload: DownloadProgressEvent = {
      id: item.id,
      streamId: item.streamId,
      status: 'downloading',
      receivedBytes: received,
      totalBytes: total,
      progress,
      speedBps,
      etaSecs
    }
    this.emit(EventChannels.DOWNLOAD_PROGRESS, payload)
  }

  private emitState(
    id: number,
    streamId: number,
    status: DownloadStatus,
    extra?: { error?: string; destPath?: string }
  ): void {
    const payload: DownloadStateEvent = { id, streamId, status, ...extra }
    this.emit(EventChannels.DOWNLOAD_STATE, payload)
  }
}

/** Singleton shared across the main process. */
export const downloadManager = new DownloadManager()

// ----------------------------------------------------------------- helpers

async function fileSizeOrZero(p: string): Promise<number> {
  try {
    const s = await stat(p)
    return s.size
  } catch {
    return 0
  }
}
