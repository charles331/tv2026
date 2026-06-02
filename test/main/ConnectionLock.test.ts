import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectionLock,
  LockResetError,
  type LockHolder
} from '../../src/main/lock/ConnectionLock'

describe('ConnectionLock', () => {
  let lock: ConnectionLock

  beforeEach(() => {
    lock = new ConnectionLock()
  })

  describe('basic acquire / release', () => {
    it('acquires immediately when free and reports busy state', async () => {
      expect(lock.isBusy()).toBe(false)
      expect(lock.current()).toBeNull()

      const token = await lock.acquire('download')

      expect(token.holder).toBe('download')
      expect(typeof token.id).toBe('number')
      expect(lock.isBusy()).toBe(true)
      expect(lock.current()).toBe('download')
      expect(lock.waiting).toBe(0)
    })

    it('frees the lock on release', async () => {
      const token = await lock.acquire('playback')
      lock.release(token)
      expect(lock.isBusy()).toBe(false)
      expect(lock.current()).toBeNull()
    })

    it('hands out monotonically increasing token ids', async () => {
      const a = await lock.acquire('download')
      lock.release(a)
      const b = await lock.acquire('download')
      expect(b.id).toBeGreaterThan(a.id)
    })
  })

  describe('tryAcquire', () => {
    it('returns a token when free and null when busy', async () => {
      const t1 = lock.tryAcquire('download')
      expect(t1).not.toBeNull()
      expect(lock.current()).toBe('download')

      const t2 = lock.tryAcquire('playback')
      expect(t2).toBeNull()

      lock.release(t1!)
      const t3 = lock.tryAcquire('playback')
      expect(t3).not.toBeNull()
      expect(t3!.holder).toBe('playback')
    })
  })

  describe('FIFO queueing', () => {
    it('hands the lock to waiters in arrival order', async () => {
      const held = await lock.acquire('download')

      const order: number[] = []
      const p1 = lock.acquire('download').then((t) => {
        order.push(1)
        return t
      })
      const p2 = lock.acquire('download').then((t) => {
        order.push(2)
        return t
      })

      expect(lock.waiting).toBe(2)

      // Release sequentially; each release should wake exactly the next waiter.
      lock.release(held)
      const t1 = await p1
      expect(order).toEqual([1])
      expect(lock.waiting).toBe(1)

      lock.release(t1)
      const t2 = await p2
      expect(order).toEqual([1, 2])
      expect(lock.waiting).toBe(0)

      lock.release(t2)
      expect(lock.isBusy()).toBe(false)
    })
  })

  describe('release token guarding', () => {
    it('ignores release with a stale / foreign token', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const real = await lock.acquire('download')

      const foreign = { id: real.id + 999, holder: 'playback' as LockHolder }
      lock.release(foreign)

      // Still held by the real holder; warning emitted.
      expect(lock.isBusy()).toBe(true)
      expect(lock.current()).toBe('download')
      expect(warn).toHaveBeenCalledTimes(1)

      lock.release(real)
      expect(lock.isBusy()).toBe(false)
      warn.mockRestore()
    })

    it('ignores a double release of the same token', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const token = await lock.acquire('download')
      lock.release(token)
      lock.release(token) // second release is a no-op + warning
      expect(warn).toHaveBeenCalledTimes(1)
      expect(lock.isBusy()).toBe(false)
      warn.mockRestore()
    })
  })

  describe('preemption (playback > download)', () => {
    it('fires onPreemptRequested("download") when playback queues behind a download', async () => {
      const held = await lock.acquire('download')
      const preempts: LockHolder[] = []
      lock.onPreemptRequested((h) => preempts.push(h))

      const playbackPromise = lock.acquire('playback')

      // The preempt signal is emitted synchronously during acquire().
      expect(preempts).toEqual(['download'])
      // Playback is still waiting until the download yields.
      expect(lock.current()).toBe('download')
      expect(lock.waiting).toBe(1)

      // Download honors the signal by releasing; playback then proceeds.
      lock.release(held)
      const playbackToken = await playbackPromise
      expect(playbackToken.holder).toBe('playback')
      expect(lock.current()).toBe('playback')
    })

    it('does NOT preempt when an equal-priority holder is queued', async () => {
      const held = await lock.acquire('download')
      const preempts: LockHolder[] = []
      lock.onPreemptRequested((h) => preempts.push(h))

      void lock.acquire('download')
      expect(preempts).toEqual([])

      lock.release(held)
    })

    it('does NOT preempt a higher-priority holder (download behind playback)', async () => {
      const held = await lock.acquire('playback')
      const preempts: LockHolder[] = []
      lock.onPreemptRequested((h) => preempts.push(h))

      void lock.acquire('download')
      expect(preempts).toEqual([])

      lock.release(held)
    })

    it('unsubscribes preempt listeners', async () => {
      const held = await lock.acquire('download')
      const preempts: LockHolder[] = []
      const off = lock.onPreemptRequested((h) => preempts.push(h))
      off()

      void lock.acquire('playback')
      expect(preempts).toEqual([])
      lock.release(held)
    })
  })

  describe('reset()', () => {
    it('rejects all pending waiters with LockResetError and clears state', async () => {
      const held = await lock.acquire('download')
      const p1 = lock.acquire('playback')
      const p2 = lock.acquire('download')
      expect(lock.waiting).toBe(2)

      lock.reset()

      await expect(p1).rejects.toBeInstanceOf(LockResetError)
      await expect(p2).rejects.toBeInstanceOf(LockResetError)
      expect(lock.isBusy()).toBe(false)
      expect(lock.current()).toBeNull()
      expect(lock.waiting).toBe(0)

      // Releasing the pre-reset token is now a harmless no-op.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      lock.release(held)
      warn.mockRestore()
    })

    it('is safe to call when idle', () => {
      expect(() => lock.reset()).not.toThrow()
      expect(lock.isBusy()).toBe(false)
    })
  })

  describe('onBusyChange', () => {
    it('emits on acquire, handoff, and release with the right reason', async () => {
      const states: Array<{ busy: boolean; reason: LockHolder | null }> = []
      lock.onBusyChange((s) => states.push(s))

      const t1 = await lock.acquire('download')
      // queue a waiter, then release to trigger a handoff
      const p2 = lock.acquire('playback')
      lock.release(t1)
      const t2 = await p2
      lock.release(t2)

      expect(states).toEqual([
        { busy: true, reason: 'download' }, // acquire
        { busy: true, reason: 'playback' }, // handoff to waiter
        { busy: false, reason: null } // final release
      ])
    })

    it('unsubscribes correctly', async () => {
      const states: unknown[] = []
      const off = lock.onBusyChange((s) => states.push(s))
      off()
      const t = await lock.acquire('download')
      lock.release(t)
      expect(states).toEqual([])
    })

    it('isolates a throwing listener so others still run', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const seen: boolean[] = []
      lock.onBusyChange(() => {
        throw new Error('boom')
      })
      lock.onBusyChange((s) => seen.push(s.busy))

      const t = await lock.acquire('download')
      expect(seen).toEqual([true])
      expect(err).toHaveBeenCalled()
      lock.release(t)
      err.mockRestore()
    })
  })
})

// Avoid unhandled-rejection noise if a test leaves a promise pending.
afterEach(() => {
  vi.restoreAllMocks()
})
