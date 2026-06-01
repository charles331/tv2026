/**
 * ConnectionLock — shared primitive enforcing the provider's "1 simultaneous
 * connection" limit. The Xtream account allows only ONE active stream at a time,
 * so the download engine and the mpv player must never both hold a connection.
 *
 * Model: a single non-reentrant mutex with a FIFO wait queue, plus a priority
 * preemption signal.
 *
 *  - acquire(holder): resolves once the caller owns the single connection.
 *    If free, resolves immediately; otherwise queues until release()/reset().
 *  - tryAcquire(holder): non-blocking; returns a token or null.
 *  - release(token): frees the lock and hands it to the next waiter (FIFO).
 *  - reset(): force-release everything and REJECT all pending waiters
 *    (with {@link LockResetError}) — used on graceful shutdown.
 *  - isBusy(): whether the lock is currently held.
 *  - current(): which holder owns it (or null).
 *
 * PRIORITY CONVENTION — PLAYBACK > DOWNLOAD.
 * Playback always takes precedence over downloading. Because the queue alone is
 * passive (a waiter just sits until the current holder releases), this lock adds
 * an explicit PREEMPTION signal so the lower-priority holder is actively told to
 * yield:
 *
 *  - When `acquire('playback')` is called while a `download` holds the lock,
 *    the lock fires the {@link onPreemptRequested} listeners with the holder
 *    that should yield (`'download'`) BEFORE returning the pending promise.
 *  - The DownloadManager subscribes via onPreemptRequested(): on receiving the
 *    signal it must stop/pause the active transfer and release() its token. That
 *    release hands the lock to the waiting playback acquirer (FIFO).
 *  - Without this signal the download holder — which only observes onBusyChange
 *    (fired on heldBy changes) — would never learn that playback is waiting, and
 *    playback would block forever. This is the bug this signal fixes.
 *
 * Each acquire returns a unique {@link LockToken}; release requires the matching
 * token to prevent a different caller from releasing someone else's lock.
 *
 * USAGE
 *   // holder of the connection (download/playback):
 *   const token = await connectionLock.acquire('playback')
 *   try { ... use the single connection ... }
 *   finally { connectionLock.release(token) }
 *
 *   // download engine, to honor preemption by playback:
 *   const off = connectionLock.onPreemptRequested((yield_) => {
 *     if (yield_ === 'download') { await stopActiveTransfer(); connectionLock.release(myToken) }
 *   })
 */

export type LockHolder = 'download' | 'playback'

export interface LockToken {
  readonly id: number
  readonly holder: LockHolder
}

/** Thrown into pending acquire() promises when reset() is called. */
export class LockResetError extends Error {
  constructor(message = 'ConnectionLock was reset; pending acquire() canceled.') {
    super(message)
    this.name = 'LockResetError'
  }
}

interface Waiter {
  holder: LockHolder
  resolve: (token: LockToken) => void
  reject: (err: Error) => void
}

export type BusyListener = (state: { busy: boolean; reason: LockHolder | null }) => void

/**
 * Called when a higher-priority holder is queued behind a lower-priority one and
 * needs the current holder to yield. Receives the holder that should release.
 */
export type PreemptListener = (holderToYield: LockHolder) => void

/** Numeric priority; higher wins. playback (2) preempts download (1). */
const PRIORITY: Record<LockHolder, number> = {
  download: 1,
  playback: 2
}

export class ConnectionLock {
  private heldBy: LockToken | null = null
  private readonly queue: Waiter[] = []
  private nextId = 1
  private readonly listeners = new Set<BusyListener>()
  private readonly preemptListeners = new Set<PreemptListener>()

  /** Whether the single connection is currently held. */
  isBusy(): boolean {
    return this.heldBy !== null
  }

  /** Who currently holds the connection, or null. */
  current(): LockHolder | null {
    return this.heldBy?.holder ?? null
  }

  /** Number of callers currently waiting. */
  get waiting(): number {
    return this.queue.length
  }

  /**
   * Acquire the connection. Resolves with a token once held.
   * The returned token MUST be passed to release().
   *
   * If the lock is held by a lower-priority holder than `holder`, a preemption
   * request is emitted so that holder yields (see class docs).
   *
   * Rejects with {@link LockResetError} if reset() is called while waiting.
   */
  acquire(holder: LockHolder): Promise<LockToken> {
    if (this.heldBy === null) {
      const token: LockToken = { id: this.nextId++, holder }
      this.heldBy = token
      this.emit()
      return Promise.resolve(token)
    }

    const promise = new Promise<LockToken>((resolve, reject) => {
      this.queue.push({ holder, resolve, reject })
    })

    // PREEMPTION: if a higher-priority holder is now waiting behind a
    // lower-priority current holder, ask the current holder to yield.
    const current = this.heldBy.holder
    if (PRIORITY[holder] > PRIORITY[current]) {
      this.emitPreempt(current)
    }

    return promise
  }

  /** Non-blocking acquire. Returns a token if free, otherwise null. */
  tryAcquire(holder: LockHolder): LockToken | null {
    if (this.heldBy !== null) return null
    const token: LockToken = { id: this.nextId++, holder }
    this.heldBy = token
    this.emit()
    return token
  }

  /**
   * Release the connection using the token from acquire().
   * No-op (with warning) if the token does not match the current holder.
   * Hands the lock to the next FIFO waiter, if any.
   */
  release(token: LockToken): void {
    if (!this.heldBy || this.heldBy.id !== token.id) {
      console.warn('[ConnectionLock] release() with stale/foreign token ignored')
      return
    }
    const next = this.queue.shift()
    if (next) {
      const nextToken: LockToken = { id: this.nextId++, holder: next.holder }
      this.heldBy = nextToken
      // Holder changed; notify, then deliver the lock to the waiter.
      this.emit()
      next.resolve(nextToken)
    } else {
      this.heldBy = null
      this.emit()
    }
  }

  /**
   * Force-release everything (graceful shutdown). All pending waiters are
   * REJECTED with {@link LockResetError} so their callers can transition to an
   * error state instead of blocking forever.
   */
  reset(): void {
    this.heldBy = null
    const pending = this.queue.splice(0, this.queue.length)
    this.emit()
    for (const w of pending) {
      try {
        w.reject(new LockResetError())
      } catch (e) {
        console.error('[ConnectionLock] waiter reject threw', e)
      }
    }
  }

  /** Subscribe to busy-state changes. Returns an unsubscribe function. */
  onBusyChange(listener: BusyListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Subscribe to preemption requests. The callback receives the holder that
   * should yield the lock (currently always the lower-priority current holder,
   * e.g. 'download' when 'playback' is waiting). The subscriber is expected to
   * stop its work and release() its token promptly. Returns an unsubscribe fn.
   */
  onPreemptRequested(listener: PreemptListener): () => void {
    this.preemptListeners.add(listener)
    return () => this.preemptListeners.delete(listener)
  }

  private emit(): void {
    const state = { busy: this.isBusy(), reason: this.current() }
    for (const l of this.listeners) {
      try {
        l(state)
      } catch (e) {
        console.error('[ConnectionLock] listener threw', e)
      }
    }
  }

  private emitPreempt(holderToYield: LockHolder): void {
    for (const l of this.preemptListeners) {
      try {
        l(holderToYield)
      } catch (e) {
        console.error('[ConnectionLock] preempt listener threw', e)
      }
    }
  }
}

/** Singleton instance shared across the main process. */
export const connectionLock = new ConnectionLock()
