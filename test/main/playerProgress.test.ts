/**
 * The player reports where a movie / episode was stopped (watch progress), so
 * it can be resumed. These are the cases that would save a wrong position.
 */
import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type FakeProc = EventEmitter & {
  pid: number
  exitCode: number | null
  killed: boolean
  kill: ReturnType<typeof vi.fn>
  stderr: EventEmitter & { setEncoding: () => void }
}
type FakeIpcT = EventEmitter & { commands: unknown[][] }
const h = vi.hoisted(() => ({
  procs: [] as FakeProc[],
  ipcs: [] as FakeIpcT[],
  /** When set, IPC connect waits for this promise (mpv socket not up yet). */
  connectGate: null as Promise<void> | null
}))

vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }))
vi.mock('../../src/main/player/mpvBinary', () => ({ resolveMpvBinary: () => 'mpv' }))
vi.mock('../../src/main/log/logger', () => ({
  appLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../../src/main/xtream', () => ({
  getXtreamClient: () => ({
    buildLiveUrl: (id: number) => `http://panel/live/u/p/${id}.ts`,
    buildMovieUrl: (id: number) => `http://panel/movie/u/p/${id}.mkv`,
    buildEpisodeUrl: (id: number) => `http://panel/series/u/p/${id}.mkv`,
    close: async () => undefined
  })
}))
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const p = new EventEmitter() as FakeProc
    p.pid = 1000 + h.procs.length
    p.exitCode = null
    p.killed = false
    p.kill = vi.fn(() => {
      p.killed = true
      return true
    })
    p.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined })
    h.procs.push(p)
    return p
  })
}))
vi.mock('../../src/main/player/mpvIpc', async () => {
  const { EventEmitter: EE } = await import('events')
  class FakeIpc extends EE {
    commands: unknown[][] = []
    constructor() {
      super()
      h.ipcs.push(this)
    }
    connect = async (): Promise<void> => {
      if (h.connectGate) await h.connectGate
    }
    command = async (args: unknown[]): Promise<unknown> => {
      this.commands.push(args)
      return null
    }
    setProperty = async (name: string, value: unknown): Promise<unknown> => {
      this.commands.push(['set_property', name, value])
      return null
    }
    getProperty = async (): Promise<unknown> => null
    observeProperty = async (): Promise<unknown> => null
    isConnected = (): boolean => true
    dispose = vi.fn()
  }
  return { MpvIpc: FakeIpc }
})

import { PlayerController } from '../../src/main/player/PlayerController'
import { connectionLock } from '../../src/main/lock/ConnectionLock'

import type { PlaybackProgressSink } from '../../src/main/player/progressTracker'
import type { PlayRequest } from '../../src/shared'

const MOVIE: PlayRequest = { kind: 'stream', mediaKind: 'movie', streamId: 7, containerExtension: 'mkv', title: 'Film A' }
const OTHER: PlayRequest = { kind: 'stream', mediaKind: 'movie', streamId: 8, containerExtension: 'mkv', title: 'Film B' }

describe('PlayerController — watch progress', () => {
  let player: PlayerController
  let reports: { id: number | undefined; pos: number; dur: number | null; ended: boolean; final: boolean }[]
  let started: (number | undefined)[]

  const playing = (ipc: FakeIpcT, pos: number, dur = 6000): void => {
    ipc.emit('property-change', { name: 'pause', data: false })
    ipc.emit('property-change', { name: 'duration', data: dur })
    ipc.emit('property-change', { name: 'time-pos', data: pos })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    h.procs.length = 0
    h.ipcs.length = 0
    connectionLock.reset()
    reports = []
    started = []
    const sink: PlaybackProgressSink = {
      started: (req) => started.push(req.streamId),
      position: (req, pos, dur, opts) => reports.push({ id: req.streamId, pos, dur, ...opts })
    }
    player = new PlayerController()
    player.attachProgress(sink)
  })
  afterEach(async () => {
    player.disposeForShutdown()
    vi.useRealTimers()
  })

  it('reports the position when the user stops', async () => {
    await player.play(MOVIE)
    playing(h.ipcs[0], 2592)
    reports.length = 0
    await player.stop()
    expect(reports).toEqual([{ id: 7, pos: 2592, dur: 6000, ended: false, final: true }])
  })

  it('reports periodically while playing (not on every tick)', async () => {
    await player.play(MOVIE)
    const ipc = h.ipcs[0]
    playing(ipc, 100)
    const first = reports.length
    ipc.emit('property-change', { name: 'time-pos', data: 101 })
    expect(reports).toHaveLength(first)
    await vi.advanceTimersByTimeAsync(10_000)
    ipc.emit('property-change', { name: 'time-pos', data: 111 })
    expect(reports.at(-1)).toMatchObject({ id: 7, pos: 111, final: false })
  })

  it('reports the end of the file once, as ended', async () => {
    await player.play(MOVIE)
    const ipc = h.ipcs[0]
    playing(ipc, 5990)
    reports.length = 0
    ipc.emit('property-change', { name: 'eof-reached', data: true })
    await player.stop() // the bar closing afterwards must not report again
    expect(reports).toEqual([{ id: 7, pos: 5990, dur: 6000, ended: true, final: true }])
  })

  it('never saves the previous film’s position under the next one', async () => {
    await player.play(MOVIE)
    playing(h.ipcs[0], 2592)
    await player.play(OTHER) // stops A (reported), starts B
    reports.length = 0
    await player.stop() // B stopped before mpv reported any position
    expect(reports).toEqual([{ id: 8, pos: 0, dur: null, ended: false, final: true }])
  })

  it('starts mpv at the resume position', async () => {
    const { spawn } = await import('child_process')
    await player.play({ ...MOVIE, startSecs: 2587.6 })
    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[]
    expect(args).toContain('--start=2587')
  })

  it('announces every playback request (recent channels)', async () => {
    await player.play(MOVIE)
    expect(started).toEqual([7])
  })
})
