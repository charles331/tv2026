import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionLock } from '../../src/main/lock/ConnectionLock'
import { probeFileSize } from '../../src/main/quality/fileProbe'

const URL_ = 'http://panel.example:8080/movie/u/p/2126360.ts'

function res(statusCode: number, headers: Record<string, string>) {
  return { statusCode, headers, body: { destroy: vi.fn() } }
}

describe('probeFileSize', () => {
  let lock: ConnectionLock
  beforeEach(() => {
    lock = new ConnectionLock()
  })

  it('reads the total size from Content-Range on a 206 and sends Range: bytes=0-0', async () => {
    const r = res(206, { 'content-range': 'bytes 0-0/634618816', 'content-length': '1' })
    const requestImpl = vi.fn().mockResolvedValue(r)
    const out = await probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl })
    expect(out).toEqual({ kind: 'ok', sizeBytes: 634618816 })
    expect(requestImpl.mock.calls[0][1].headers.range).toBe('bytes=0-0')
    expect(r.body.destroy).toHaveBeenCalled()
    expect(lock.isBusy()).toBe(false)
  })

  it('falls back to Content-Length when the server ignores Range (200), without reading the body', async () => {
    const r = res(200, { 'content-length': '1431098552' })
    const out = await probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl: vi.fn().mockResolvedValue(r) })
    expect(out).toEqual({ kind: 'ok', sizeBytes: 1431098552 })
    expect(r.body.destroy).toHaveBeenCalled()
  })

  it('reports busy and makes no request while a download holds the connection', async () => {
    const held = await lock.acquire('download')
    const requestImpl = vi.fn()
    expect(await probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl })).toEqual({ kind: 'busy' })
    expect(requestImpl).not.toHaveBeenCalled()
    lock.release(held)
  })

  it('aborts and yields when playback queues behind it', async () => {
    const requestImpl = vi.fn(
      (_u: string, o: { signal: AbortSignal }) =>
        new Promise((_res, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    )
    const probe = probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl: requestImpl as never })
    const playback = lock.acquire('playback')
    expect(await probe).toEqual({ kind: 'busy' })
    expect((await playback).holder).toBe('playback')
  })

  it('returns an error (and frees the lock) on an unexpected status or a network failure', async () => {
    expect(
      await probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl: vi.fn().mockResolvedValue(res(403, {})) })
    ).toMatchObject({ kind: 'error' })
    expect(
      await probeFileSize(URL_, { userAgent: 'UA', lock, requestImpl: vi.fn().mockRejectedValue(new Error('ECONNRESET')) })
    ).toEqual({ kind: 'error', message: 'ECONNRESET' })
    expect(lock.isBusy()).toBe(false)
  })
})
