/**
 * fileProbe — learn a movie file's REAL size without downloading it.
 *
 * The provider's get_vod_info carries no size/bitrate/resolution, but the media
 * endpoint honours Range: asking for `bytes=0-0` returns `206` with
 * `Content-Range: bytes 0-0/<total>`. One round trip (302 → backend), one byte.
 *
 * Single-connection rule: the request hits the media endpoint, so it runs under
 * the ConnectionLock as the lowest-priority 'probe' holder, taken with
 * tryAcquire() only (never waits). If a download/playback queues behind it,
 * the preempt signal aborts the probe immediately.
 */

import { Agent, interceptors, request, type Dispatcher } from 'undici'
import { connectionLock, type ConnectionLock } from '../lock/ConnectionLock'
import { headerValue, parseContentRangeTotal } from '../downloads/helpers'

export type ProbeOutcome =
  | { kind: 'ok'; sizeBytes: number }
  /** Connection held by a download/playback, or the probe yielded to one. */
  | { kind: 'busy' }
  | { kind: 'error'; message: string }

type RequestFn = (
  url: string,
  opts: { dispatcher: Dispatcher; method: 'GET'; headers: Record<string, string>; signal: AbortSignal }
) => Promise<{
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: { destroy(): unknown }
}>

export interface ProbeOptions {
  userAgent: string
  timeoutMs?: number
  /** Test seams. */
  lock?: ConnectionLock
  requestImpl?: RequestFn
}

export async function probeFileSize(url: string, opts: ProbeOptions): Promise<ProbeOutcome> {
  const lock = opts.lock ?? connectionLock
  const token = lock.tryAcquire('probe')
  if (!token) return { kind: 'busy' }

  const ctl = new AbortController()
  let preempted = false
  const offPreempt = lock.onPreemptRequested((h) => {
    if (h !== 'probe') return
    preempted = true
    ctl.abort()
  })
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000)
  const agent = new Agent({ headersTimeout: 10_000, connect: { timeout: 10_000 } })
  const doRequest = opts.requestImpl ?? (request as unknown as RequestFn)

  try {
    const res = await doRequest(url, {
      dispatcher: agent.compose(interceptors.redirect({ maxRedirections: 5 })),
      method: 'GET',
      headers: { range: 'bytes=0-0', 'user-agent': opts.userAgent, accept: '*/*' },
      signal: ctl.signal
    })
    // Never read the body: one byte on 206, the WHOLE file on a 200.
    res.body.destroy()
    if (res.statusCode === 206) {
      const total = parseContentRangeTotal(headerValue(res.headers['content-range']))
      if (total && total > 0) return { kind: 'ok', sizeBytes: total }
    } else if (res.statusCode === 200) {
      const len = Number(headerValue(res.headers['content-length']))
      if (Number.isFinite(len) && len > 0) return { kind: 'ok', sizeBytes: len }
    }
    return { kind: 'error', message: `réponse inattendue du serveur (HTTP ${res.statusCode})` }
  } catch (e) {
    if (preempted) return { kind: 'busy' }
    if (ctl.signal.aborted) return { kind: 'error', message: 'le serveur ne répond pas' }
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    offPreempt()
    lock.release(token)
    void agent.close().catch(() => undefined)
  }
}
