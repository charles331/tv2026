/**
 * mediaProbe — read a movie's REAL resolution and codec ("Analyser").
 *
 * The provider exposes neither, so we let mpv (already bundled for playback)
 * open the file and decode its first frame only: `--frames=1`, no audio, no
 * video output, no cache readahead. It reads the container header and up to
 * the first key frame — typically a few MB — then exits, printing one marker
 * line we parse. Works for every container the provider uses (TS/MKV/MP4).
 *
 * Single connection: same rules as fileProbe — lowest-priority 'probe' holder,
 * taken with tryAcquire() only, and mpv is killed as soon as a download or
 * playback queues behind it.
 */

import { spawn as nodeSpawn } from 'child_process'
import type { VideoInfo } from '@shared/index'
import { connectionLock, type ConnectionLock } from '../lock/ConnectionLock'

export type MediaProbeOutcome =
  | { kind: 'ok'; video: VideoInfo }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }

const MARKER = 'TV2026PROBE'

/** Parse mpv's marker line: "TV2026PROBE <width> <height> <codec>". */
export function parseProbeOutput(stdout: string): VideoInfo | null {
  const m = new RegExp(`${MARKER} (\\d+) (\\d+) (\\S+)`).exec(stdout)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  return width > 0 && height > 0 ? { width, height, codec: m[3]!.toLowerCase() } : null
}

interface ChildLike {
  stdout: { on(ev: 'data', cb: (d: Buffer) => void): unknown } | null
  on(ev: 'close', cb: (code: number | null) => void): unknown
  on(ev: 'error', cb: (err: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface MediaProbeOptions {
  binary: string
  userAgent: string
  timeoutMs?: number
  lock?: ConnectionLock
  spawnImpl?: (cmd: string, args: string[], opts: object) => ChildLike
}

export async function probeMedia(url: string, opts: MediaProbeOptions): Promise<MediaProbeOutcome> {
  const lock = opts.lock ?? connectionLock
  const token = lock.tryAcquire('probe')
  if (!token) return { kind: 'busy' }

  const args = [
    '--no-config',
    '--vo=null',
    '--ao=null',
    '--aid=no',
    '--sid=no',
    '--frames=1',
    '--cache=no',
    '--demuxer-readahead-secs=0',
    '--network-timeout=15',
    `--user-agent=${opts.userAgent}`,
    '--msg-level=all=error,term-msg=info',
    '--term-status-msg=',
    `--term-playing-msg=${MARKER} \${=width} \${=height} \${=video-format}`,
    url
  ]
  const spawnFn = opts.spawnImpl ?? (nodeSpawn as unknown as NonNullable<MediaProbeOptions['spawnImpl']>)

  let stopReason: 'preempted' | 'timeout' | null = null
  let child: ChildLike | null = null
  const offPreempt = lock.onPreemptRequested((h) => {
    if (h !== 'probe' || !child) return
    stopReason = 'preempted'
    child.kill()
  })

  try {
    return await new Promise<MediaProbeOutcome>((resolve) => {
      let out = ''
      let c: ChildLike
      try {
        c = spawnFn(opts.binary, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      } catch (e) {
        resolve({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        return
      }
      child = c
      const timer = setTimeout(() => {
        stopReason = 'timeout'
        c.kill()
      }, opts.timeoutMs ?? 30_000)
      c.stdout?.on('data', (d: Buffer) => {
        out += d.toString('utf8')
      })
      c.on('error', (err: Error) => {
        clearTimeout(timer)
        resolve({ kind: 'error', message: err.message })
      })
      c.on('close', () => {
        clearTimeout(timer)
        if (stopReason === 'preempted') return resolve({ kind: 'busy' })
        if (stopReason === 'timeout') return resolve({ kind: 'error', message: 'le serveur ne répond pas' })
        const video = parseProbeOutput(out)
        resolve(video ? { kind: 'ok', video } : { kind: 'error', message: 'aucune piste vidéo lisible' })
      })
    })
  } finally {
    offPreempt()
    lock.release(token)
  }
}
