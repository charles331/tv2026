/**
 * TV mode of the player: mpv full screen with the remote's keys, keys sent
 * back to the app, and the app back in front when the video is left.
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

import { spawn } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PlayerController } from '../../src/main/player/PlayerController'
import { connectionLock } from '../../src/main/lock/ConnectionLock'
import type { PlayRequest } from '../../src/shared'

const MOVIE: PlayRequest = {
  kind: 'stream',
  mediaKind: 'movie',
  streamId: 7,
  containerExtension: 'mkv',
  title: 'Film A'
}
const CHANNEL: PlayRequest = {
  kind: 'stream',
  mediaKind: 'live',
  streamId: 101,
  containerExtension: 'ts',
  title: 'Chaîne'
}
const lastArgs = (): string[] => {
  const calls = vi.mocked(spawn).mock.calls
  return calls[calls.length - 1]![1] as string[]
}

describe('PlayerController — TV mode', () => {
  let player: PlayerController
  let focusApp: ReturnType<typeof vi.fn>
  let events: { channel: string; payload: unknown }[]
  let confDir: string

  beforeEach(() => {
    h.procs.length = 0
    h.ipcs.length = 0
    h.connectGate = null
    vi.mocked(spawn).mockClear()
    connectionLock.reset()
    events = []
    focusApp = vi.fn()
    confDir = mkdtempSync(join(tmpdir(), 'tv2026-test-'))
    player = new PlayerController()
    player.attach(((channel: string, payload: unknown) =>
      events.push({ channel, payload })) as never)
    player.attachTvSupport({ confDir, focusApp })
  })
  afterEach(() => {
    player.disposeForShutdown()
  })

  it('outside TV mode, mpv is launched exactly as before', async () => {
    await player.play(MOVIE)
    const args = lastArgs()
    expect(args).not.toContain('--fullscreen=yes')
    expect(args).not.toContain('--ontop=yes')
    expect(args.some((a) => a.startsWith('--input-conf='))).toBe(false)
  })

  it('in TV mode, mpv is full screen, on top, with the remote keys from the private folder', async () => {
    player.setTvMode(true)
    await player.play(MOVIE)
    const args = lastArgs()
    expect(args).toContain('--fullscreen=yes')
    expect(args).toContain('--ontop=yes')
    const conf = join(confDir, 'mpv-remote-vod.conf')
    expect(args).toContain(`--input-conf=${conf}`)
    expect(readFileSync(conf, 'utf8')).toContain('RIGHT seek 30; show-progress')
    await player.play(CHANNEL)
    expect(lastArgs()).toContain(`--input-conf=${join(confDir, 'mpv-remote-live.conf')}`)
  })

  it('Back from the video stops it and brings the app back, even while loading', async () => {
    player.setTvMode(true)
    let open: () => void = () => undefined
    h.connectGate = new Promise<void>((r) => (open = r))
    const playing = player.play(MOVIE)
    await Promise.resolve()
    expect(player.getStatus().state).toBe('loading')
    await player.handleRemote('back')
    open()
    await playing.catch(() => undefined)
    expect(player.getStatus().state).toBe('idle')
    expect(focusApp).toHaveBeenCalled()
  })

  it('previous / next from the video go to the app (zapping, episodes)', async () => {
    player.setTvMode(true)
    await player.play(CHANNEL)
    h.ipcs[0]!.emit('event', { event: 'client-message', args: ['tv2026', 'next'] })
    await Promise.resolve()
    expect(
      events.some(
        (e) =>
          e.channel === 'event:player:remote' && (e.payload as { action: string }).action === 'next'
      )
    ).toBe(true)
  })

  it('a user stop brings the app back in TV mode; a source switch does not', async () => {
    player.setTvMode(true)
    await player.play(CHANNEL)
    await player.play(MOVIE) // zapping / next episode: internal stop
    expect(focusApp).not.toHaveBeenCalled()
    await player.stopFromUser()
    expect(focusApp).toHaveBeenCalledTimes(1)
  })

  it('the status says whether the playing video was launched in TV mode', async () => {
    player.setTvMode(true)
    await player.play(MOVIE)
    expect(player.getStatus().tvSession).toBe(true)
    const states = events.filter((e) => e.channel === 'event:player:state')
    expect((states[states.length - 1]!.payload as { tvSession?: boolean }).tvSession).toBe(true)
  })

  it('a video launched outside TV mode is not driven as TV when the mode turns on', async () => {
    await player.play(MOVIE)
    player.setTvMode(true)
    await player.bringAppToFront()
    expect(h.ipcs[0]!.commands.some((c) => c[0] === 'set_property' && c[1] === 'ontop')).toBe(false)
    expect(focusApp).not.toHaveBeenCalled()
    expect(player.getStatus().tvSession).toBe(false)
  })

  it('a stop while waiting for the connection gives it back once obtained', async () => {
    const download = await connectionLock.acquire('download')
    const playing = player.play(CHANNEL)
    await Promise.resolve()
    await player.stopFromUser()
    connectionLock.release(download)
    await playing.catch(() => undefined)
    await Promise.resolve()
    expect(connectionLock.isBusy()).toBe(false)
  })
})
