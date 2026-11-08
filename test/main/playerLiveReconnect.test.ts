/**
 * Live reconnect must keep the user's mpv window: the provider cuts live
 * streams every few minutes (end-file eof while mpv is still running), and
 * killing + respawning mpv opened a new window at an arbitrary place.
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

const LIVE = {
  kind: 'stream' as const,
  mediaKind: 'live' as const,
  streamId: 42,
  containerExtension: 'ts',
  title: 'DAZN'
}

describe('PlayerController — live reconnect', () => {
  let player: PlayerController

  beforeEach(() => {
    vi.useFakeTimers()
    h.procs.length = 0
    h.ipcs.length = 0
    connectionLock.reset()
    player = new PlayerController()
  })
  afterEach(async () => {
    player.disposeForShutdown()
    vi.useRealTimers()
  })

  it('reloads the stream in the SAME mpv (same window) when the provider ends it', async () => {
    await player.play(LIVE)
    expect(h.procs).toHaveLength(1)
    const ipc = h.ipcs[0]
    ipc.emit('event', { event: 'playback-restart' }) // first frames: window sized to the video

    // From now on mpv must keep the window size the user chooses. Measured: a
    // cut of type "error" unloads the video and resets the window BEFORE the
    // app can react, so this has to be set as soon as playback starts.
    expect(ipc.commands).toContainEqual(['set_property', 'auto-window-resize', false])

    ipc.emit('end-file', { reason: 'eof' }) // provider cut the stream
    await vi.advanceTimersByTimeAsync(0)
    expect(player.getStatus().state).toBe('reconnecting')
    // The stream is closed (frees the provider connection) but mpv stays alive.
    expect(ipc.commands).toContainEqual(['stop'])
    expect(h.procs[0].kill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500) // backoff
    expect(ipc.commands).toContainEqual(['loadfile', 'http://panel/live/u/p/42.ts', 'replace'])
    expect(h.procs).toHaveLength(1) // no new process → no new window
    expect(connectionLock.current()).toBe('playback') // lock kept throughout

    // Playback really resumed in the same mpv → the bar leaves "Reconnexion…".
    ipc.emit('event', { event: 'playback-restart' })
    expect(player.getStatus().state).toBe('playing')
  })

  it('ignores the end-file "stop" caused by its own reconnect, and keeps retrying with the same mpv', async () => {
    await player.play(LIVE)
    const ipc = h.ipcs[0]
    ipc.emit('end-file', { reason: 'eof' })
    ipc.emit('end-file', { reason: 'stop' }) // mpv's echo of our own `stop`
    await vi.advanceTimersByTimeAsync(2500)
    ipc.emit('end-file', { reason: 'error' }) // the reload failed too (panel still busy)
    await vi.advanceTimersByTimeAsync(5000)
    const loads = ipc.commands.filter((c: unknown[]) => c[0] === 'loadfile')
    expect(loads).toHaveLength(2)
    expect(h.procs).toHaveLength(1)
  })

  it('still respawns mpv when the process itself died (crash / window closed)', async () => {
    await player.play(LIVE)
    h.procs[0].exitCode = 1
    h.procs[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2500)
    expect(h.procs).toHaveLength(2)
  })

  it('does not reload after the user stopped during the backoff', async () => {
    await player.play(LIVE)
    const ipc = h.ipcs[0]
    ipc.emit('end-file', { reason: 'eof' })
    await vi.advanceTimersByTimeAsync(0)
    await player.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(ipc.commands.some((c: unknown[]) => c[0] === 'loadfile')).toBe(false)
    expect(player.getStatus().state).toBe('idle')
  })

  it('a playback cancelled while mpv is still starting ends silently (no error 8 s later)', async () => {
    let failConnect: (e: Error) => void = () => undefined
    h.connectGate = new Promise<void>((_res, rej) => {
      failConnect = rej
    })
    const first = player.play({ ...LIVE, mediaKind: 'movie' as const })
    await vi.advanceTimersByTimeAsync(0)
    await player.stop() // e.g. the player bar unmounting right away
    failConnect(new Error('connect ENOENT /tmp/tv2026-mpv.sock')) // the killed mpv never opened its socket
    h.connectGate = null
    const status = await first
    expect(status.state).not.toBe('error')
    expect(player.getStatus().state).toBe('idle')
  })

  it('reports how far mpv has loaded (buffer) and the current audio track', async () => {
    const emitted: unknown[] = []
    player.attach(((_ch: string, payload: unknown) => emitted.push(payload)) as never)
    await player.play({ ...LIVE, mediaKind: 'movie' as const })
    const ipc = h.ipcs[0]!
    ipc.emit('property-change', { name: 'time-pos', data: 394 })
    ipc.emit('property-change', { name: 'demuxer-cache-time', data: 1000.4 })
    ipc.emit('property-change', {
      name: 'current-tracks/audio',
      data: { id: 2, lang: 'fre', title: 'Français 5.1', codec: 'eac3' }
    })
    expect(player.getStatus().bufferedSecs).toBeCloseTo(1000.4)
    expect(player.getStatus().audioTrack).toBe('Français 5.1 (fre)')
    await vi.advanceTimersByTimeAsync(600)
    ipc.emit('property-change', { name: 'time-pos', data: 395 })
    expect(emitted).toContainEqual(expect.objectContaining({ positionSecs: 395, bufferedSecs: 1000.4 }))
    ipc.emit('property-change', { name: 'current-tracks/audio', data: { id: 1, lang: 'eng' } })
    expect(player.getStatus().audioTrack).toBe('eng')
  })

  it('closing the video window (mpv "quit") stops the live — no reconnect, no new window', async () => {
    await player.play(LIVE)
    const ipc = h.ipcs[0]!
    // What mpv does when its window is closed: end-file "quit", then its IPC
    // socket closes and the process exits with code 0.
    ipc.emit('end-file', { reason: 'quit' })
    ipc.emit('close')
    h.procs[0]!.exitCode = 0
    h.procs[0]!.emit('exit', 0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.procs).toHaveLength(1) // nothing respawned
    expect(player.getStatus().state).toBe('idle')
    expect(connectionLock.isBusy()).toBe(false) // provider connection released
  })
})

