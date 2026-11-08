import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionLock } from '../../src/main/lock/ConnectionLock'
import { probeMedia, parseProbeOutput } from '../../src/main/quality/mediaProbe'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
  exitCode: number | null
}

function fakeMpv(stdout: string | null, code = 0): { spawn: ReturnType<typeof vi.fn>; child: FakeChild } {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.kill = vi.fn(() => {
    setTimeout(() => {
      child.exitCode = 143
      child.emit('close', null)
    }, 0)
    return true
  })
  const spawn = vi.fn(() => {
    if (stdout !== null) {
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(stdout))
        child.exitCode = code
        child.emit('close', code)
      }, 5)
    }
    return child
  })
  return { spawn, child }
}

describe('parseProbeOutput', () => {
  it('reads width, height and codec from the marker line', () => {
    expect(parseProbeOutput('noise\nTV2026PROBE 1920 800 hevc\n')).toEqual({ width: 1920, height: 800, codec: 'hevc' })
  })
  it('returns null when mpv found no video', () => {
    expect(parseProbeOutput('TV2026PROBE   \n')).toBeNull()
    expect(parseProbeOutput('')).toBeNull()
  })
})

describe('probeMedia', () => {
  let lock: ConnectionLock
  beforeEach(() => {
    lock = new ConnectionLock()
  })

  it('runs mpv on the first frame only, without audio, and returns the video info', async () => {
    const { spawn } = fakeMpv('TV2026PROBE 1920 1080 h264\n')
    const out = await probeMedia('http://p/movie/u/p/1.mkv', { binary: 'mpv', userAgent: 'UA', lock, spawnImpl: spawn })
    expect(out).toEqual({ kind: 'ok', video: { width: 1920, height: 1080, codec: 'h264' } })
    const args = spawn.mock.calls[0]![1] as string[]
    expect(args).toEqual(expect.arrayContaining(['--frames=1', '--ao=null', '--vo=null', '--no-config']))
    expect(args[args.length - 1]).toBe('http://p/movie/u/p/1.mkv')
    expect(lock.isBusy()).toBe(false)
  })

  it('is busy (and spawns nothing) while a download or playback holds the connection', async () => {
    const held = await lock.acquire('playback')
    const { spawn } = fakeMpv('TV2026PROBE 1 1 h264\n')
    expect(await probeMedia('u', { binary: 'mpv', userAgent: 'UA', lock, spawnImpl: spawn })).toEqual({ kind: 'busy' })
    expect(spawn).not.toHaveBeenCalled()
    lock.release(held)
  })

  it('kills mpv and yields when playback is requested meanwhile', async () => {
    const { spawn, child } = fakeMpv(null) // never answers on its own
    const probe = probeMedia('u', { binary: 'mpv', userAgent: 'UA', lock, spawnImpl: spawn })
    const playback = lock.acquire('playback')
    expect(await probe).toEqual({ kind: 'busy' })
    expect(child.kill).toHaveBeenCalled()
    expect((await playback).holder).toBe('playback')
  })

  it('times out (killing mpv) and reports an error when nothing comes back', async () => {
    vi.useFakeTimers()
    const { spawn, child } = fakeMpv(null)
    const probe = probeMedia('u', { binary: 'mpv', userAgent: 'UA', lock, spawnImpl: spawn, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(await probe).toMatchObject({ kind: 'error' })
    expect(child.kill).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reports an error when mpv finds no video stream', async () => {
    const { spawn } = fakeMpv('', 2)
    expect(await probeMedia('u', { binary: 'mpv', userAgent: 'UA', lock, spawnImpl: spawn })).toMatchObject({ kind: 'error' })
  })
})
