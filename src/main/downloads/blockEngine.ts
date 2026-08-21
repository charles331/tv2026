/**
 * Block download engine — sequential BOUNDED range requests.
 *
 * Providers pace a long streaming-style connection down to roughly the media
 * bitrate after an initial burst, which is why a continuous download of a movie
 * takes about as long as the movie. Re-requesting bounded ranges keeps
 * re-triggering that burst (the same thing that makes seeking in a player feel
 * instant).
 *
 * STRICTLY sequential: exactly one request in flight, so the provider's
 * single-connection limit is respected. The speed-up comes from restarting the
 * burst, never from parallelism.
 *
 * INTEGRITY RULES (this code appends to a multi-GB file — a mistake silently
 * corrupts the user's movie):
 *  - a block is appended ONLY if its `Content-Range` start is positively
 *    confirmed to equal the current end of the `.part`; "unverifiable" is
 *    treated as unsafe, never as OK;
 *  - the total size is latched from the first `206` and any later disagreement
 *    is fatal (the remote file changed under us);
 *  - once any valid `206` proved ranges work, a later `200` is a server ERROR
 *    (expired token, error page), never a "ranges unsupported" signal;
 *  - the offset is re-derived from the file itself after every block, so a short
 *    block self-corrects on the next request.
 *
 * Dependencies are injected so the whole loop is integration-tested against a
 * local HTTP server with KB-sized payloads (see test/main/blockEngine.test.ts).
 */

import { createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import type { Readable } from 'stream'

import {
  CHUNK_INITIAL_BYTES,
  CHUNK_MAX_BYTES,
  CHUNK_MIN_BYTES,
  HttpStatusError,
  IntegrityError,
  applyChunkDecision,
  chunkSizeDecision,
  headerValue,
  parseContentRangeStart,
  parseContentRangeTotal,
  type ChunkDecision
} from './helpers'

/** Minimal response shape (matches undici's `request` result). */
export interface BlockResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: Readable & { dump?: () => Promise<unknown> }
}

export type BlockRequestFn = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<BlockResponse>

export interface BlockEngineOptions {
  url: string
  /** Absolute path of the `.part` file blocks are appended to. */
  partPath: string
  /** Byte offset to resume from (the current `.part` size). */
  startOffset: number
  /** Total size if already known (e.g. from a previous run); may be stale. */
  knownTotal: number | null
  signal: AbortSignal
  request: BlockRequestFn
  /** Called on every received chunk (throttling is the caller's business). */
  onProgress?: (received: number, total: number | null) => void
  /** Called after each completed block (progress persistence). */
  onBlockDone?: (offset: number, total: number | null) => void
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  /** Non-null when the transfer must stop (pause/cancel/playback/shutdown). */
  interruptReason?: () => string | null
  /** Builds the error thrown when `interruptReason()` fires. */
  makeInterruptError?: (reason: string) => Error
  initialChunkBytes?: number
  /** Block-size bounds (overridable so the engine is testable with KB payloads). */
  minChunkBytes?: number
  maxChunkBytes?: number
  /** Retries for ONE block before giving up (transient network hiccups). */
  maxBlockRetries?: number
  /** Politeness delay between blocks (provider rate-limit protection). */
  interBlockDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Hard cap on the number of requests for one file. */
  maxBlocks?: number
}

export type BlockEngineOutcome =
  | { outcome: 'done'; totalBytes: number | null }
  | { outcome: 'fallback'; reason: string; totalBytes: number | null }

/** Statuses that mean "stop hammering the provider" → hand over to continuous. */
const RATE_LIMIT_STATUSES = new Set([429, 403, 503])
/** Bytes ignored at the start of a block when measuring (TCP slow start). */
const MEASURE_SKIP_BYTES = 1024 * 1024
/** Throughput sampling window inside a block. */
const SAMPLE_WINDOW_MS = 500

async function fileSizeOrZero(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}

function clampChunk(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/**
 * Download `partPath` from `url` in bounded blocks. Returns 'done' when the file
 * is complete, or 'fallback' when the provider cannot be driven this way (the
 * caller then finishes with a single continuous request).
 *
 * Never returns 'done' on an incomplete file: the caller validates the final
 * size against the returned `totalBytes` before the atomic rename.
 */
export async function runBlockDownload(opts: BlockEngineOptions): Promise<BlockEngineOutcome> {
  const log = opts.log ?? ((): void => {})
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxBlockRetries ?? 4
  const interBlockDelayMs = opts.interBlockDelayMs ?? 100
  const maxBlocks = opts.maxBlocks ?? 4096
  const interruptReason = opts.interruptReason ?? ((): string | null => null)
  const makeInterruptError =
    opts.makeInterruptError ?? ((reason: string): Error => new Error(`interrupted: ${reason}`))

  let offset = opts.startOffset
  /** Authoritative total, latched from the first 206 (never re-assigned). */
  let latchedTotal: number | null = null
  const minChunk = opts.minChunkBytes ?? CHUNK_MIN_BYTES
  const maxChunk = opts.maxChunkBytes ?? CHUNK_MAX_BYTES
  let chunkSize = clampChunk(opts.initialChunkBytes ?? CHUNK_INITIAL_BYTES, minChunk, maxChunk)
  let sawValid206 = false
  let blocks = 0
  let retries = 0
  let lastDecision: ChunkDecision = 'keep'

  const total = (): number | null => latchedTotal ?? opts.knownTotal

  const checkInterrupt = (): void => {
    const reason = interruptReason()
    if (reason) throw makeInterruptError(reason)
  }

  while (true) {
    checkInterrupt()

    const known = total()
    if (known !== null && offset >= known) {
      return { outcome: 'done', totalBytes: latchedTotal }
    }
    if (blocks >= maxBlocks) {
      return {
        outcome: 'fallback',
        reason: `plafond de ${maxBlocks} blocs atteint`,
        totalBytes: latchedTotal
      }
    }

    const wantEnd =
      known !== null ? Math.min(offset + chunkSize - 1, known - 1) : offset + chunkSize - 1
    const wantBytes = wantEnd - offset + 1

    let decision: ChunkDecision = 'keep'
    let fellBack: string | null = null

    try {
      const res = await opts.request(opts.url, {
        headers: {
          range: `bytes=${offset}-${wantEnd}`,
          // undici pools sockets per origin; this is what makes each block a
          // genuinely NEW connection, which is what restarts the burst.
          connection: 'close'
        },
        signal: opts.signal
      })

      // ---------------- status handling ----------------
      if (res.statusCode !== 206) {
        await res.body.dump?.().catch(() => undefined)
        if (RATE_LIMIT_STATUSES.has(res.statusCode)) {
          return {
            outcome: 'fallback',
            reason: `le serveur a répondu HTTP ${res.statusCode} (limitation)`,
            totalBytes: latchedTotal
          }
        }
        if (res.statusCode === 416) {
          // Requested range beyond EOF: the declared total was too large. Treat
          // the bytes on disk as the whole file; the caller's size check then
          // validates against THIS total rather than the bogus one.
          if (offset > 0) {
            log('warn', `plage refusée (416) à ${offset} — fichier considéré complet`)
            return { outcome: 'done', totalBytes: offset }
          }
          throw new HttpStatusError(416)
        }
        if (res.statusCode === 200) {
          // Ranges already proved to work ⇒ a 200 now is a server error (expired
          // token, error page), NOT a capability signal. Never let it trigger the
          // continuous path, which would delete the .part and could finalize a
          // few-hundred-byte error page as the movie.
          if (sawValid206) {
            throw new HttpStatusError(200)
          }
          return {
            outcome: 'fallback',
            reason: 'le serveur ignore les requêtes par bloc (HTTP 200)',
            totalBytes: latchedTotal
          }
        }
        throw new HttpStatusError(res.statusCode)
      }

      // ---------------- integrity guards ----------------
      const contentRange = headerValue(res.headers['content-range'])
      const rangeStart = parseContentRangeStart(contentRange)
      if (rangeStart === null) {
        // Unverifiable ⇒ unsafe. Appending a block whose real start is unknown
        // could splice bytes into the wrong place.
        await res.body.dump?.().catch(() => undefined)
        return {
          outcome: 'fallback',
          reason: 'réponse 206 sans Content-Range exploitable',
          totalBytes: latchedTotal
        }
      }
      if (rangeStart !== offset) {
        await res.body.dump?.().catch(() => undefined)
        throw new IntegrityError(
          `Bloc incohérent renvoyé par le serveur (attendu à ${offset}, reçu à ${rangeStart}).`
        )
      }

      const parsedTotal = parseContentRangeTotal(contentRange)
      if (parsedTotal !== null) {
        if (latchedTotal === null) {
          latchedTotal = parsedTotal
        } else if (parsedTotal !== latchedTotal) {
          await res.body.dump?.().catch(() => undefined)
          throw new IntegrityError(
            `La taille du fichier a changé sur le serveur (${latchedTotal} → ${parsedTotal}) : téléchargement interrompu pour ne pas mélanger deux versions.`
          )
        }
      }

      const declaredLen = Number(headerValue(res.headers['content-length']))
      if (Number.isFinite(declaredLen) && declaredLen > wantBytes * 1.5) {
        await res.body.dump?.().catch(() => undefined)
        return {
          outcome: 'fallback',
          reason: 'borne de fin ignorée par le serveur',
          totalBytes: latchedTotal
        }
      }

      sawValid206 = true

      // ---------------- append the block, measuring throughput ----------------
      // Measurement skips the first MiB (TCP slow start on a fresh connection
      // would otherwise make every block look like it accelerates, biasing the
      // size upward until it pegs at the maximum).
      const out = createWriteStream(opts.partPath, { flags: 'a' })
      const overshootLimit = Math.floor(wantBytes * 1.5)
      const skipUntil = offset + Math.min(MEASURE_SKIP_BYTES, Math.floor(wantBytes / 4))
      const tailFrom = offset + Math.floor(wantBytes * 0.75)
      let received = offset
      let overshot = false
      let measureTs = 0
      let measureBytes = 0
      let windowTs = 0
      let windowBytes = 0
      let peakBps = 0
      let tailTs = 0
      let tailBytes = 0

      const counter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          received += chunk.length
          const now = Date.now()

          if (measureTs === 0 && received >= skipUntil) {
            measureTs = now
            measureBytes = received
            windowTs = now
            windowBytes = received
          } else if (measureTs !== 0 && now - windowTs >= SAMPLE_WINDOW_MS) {
            const bps = (received - windowBytes) / ((now - windowTs) / 1000)
            if (bps > peakBps) peakBps = bps
            windowTs = now
            windowBytes = received
          }
          if (tailTs === 0 && measureTs !== 0 && received >= tailFrom) {
            tailTs = now
            tailBytes = received
          }

          // The end bound may also be ignored WITHOUT a Content-Length (chunked
          // transfer encoding): enforce it on the received bytes too, otherwise
          // one "block" would silently stream the whole tail.
          if (!overshot && received - offset > overshootLimit) {
            overshot = true
            cb(new Error('BLOCK_OVERSHOOT'))
            return
          }

          opts.onProgress?.(received, total())
          cb(null, chunk)
        }
      })

      try {
        await pipeline(res.body, counter, out, { signal: opts.signal })
      } catch (e) {
        if (overshot) {
          fellBack = 'borne de fin ignorée par le serveur (flux non borné)'
        } else {
          throw e
        }
      }

      if (!fellBack) {
        const endTs = Date.now()
        // Peak: also fold in the final partial window and the whole measured span.
        if (measureTs !== 0) {
          const spanSecs = (endTs - measureTs) / 1000
          if (spanSecs > 0) {
            const avg = (received - measureBytes) / spanSecs
            if (avg > peakBps) peakBps = avg
          }
          const tailSecs = tailTs !== 0 ? (endTs - tailTs) / 1000 : 0
          const tailBps = tailSecs > 0 ? (received - tailBytes) / tailSecs : 0
          decision = chunkSizeDecision(peakBps, tailBps)
        }
      }
    } catch (e) {
      // Interrupts and integrity failures are terminal; transient network errors
      // retry THIS block (the offset is re-derived from disk, so a retry is safe).
      const name = (e as Error)?.name
      // Retry only genuine NETWORK hiccups. An explicit HTTP status means the
      // server refused (expired token, error page, gone) — retrying would just
      // hammer it and could mask the failure; the `.part` is kept either way.
      const terminal =
        e instanceof IntegrityError ||
        e instanceof HttpStatusError ||
        name === 'AbortError' ||
        name === 'TransferInterrupt' ||
        interruptReason() !== null
      if (terminal) throw e
      if (retries >= maxRetries) throw e
      retries++
      const backoff = Math.min(8000, 500 * 2 ** (retries - 1))
      log('warn', `bloc à ${offset} en échec (${(e as Error)?.message ?? e}) — nouvelle tentative ${retries}/${maxRetries} dans ${backoff} ms`)
      // Re-derive the offset: a partially written block is already on disk.
      offset = await fileSizeOrZero(opts.partPath)
      await sleep(backoff)
      continue
    }

    blocks++

    // Re-derive from the file itself: self-correcting when a block was cut short.
    const onDisk = await fileSizeOrZero(opts.partPath)
    if (fellBack) {
      log('warn', `${fellBack} → mode continu`)
      return { outcome: 'fallback', reason: fellBack, totalBytes: latchedTotal }
    }
    if (onDisk <= offset) {
      if (retries >= maxRetries) {
        throw new IntegrityError('Le serveur n’a envoyé aucune donnée pour ce bloc.')
      }
      retries++
      await sleep(500)
      continue
    }
    offset = onDisk
    retries = 0
    opts.onBlockDone?.(offset, total())

    // Adapt the block size, but only when the same signal repeats (hysteresis:
    // one noisy sample must not move the size).
    if (decision !== 'keep' && decision === lastDecision) {
      const next = applyChunkDecision(chunkSize, decision, {
        minBytes: minChunk,
        maxBytes: maxChunk
      })
      if (next !== chunkSize) {
        log('info', `bloc ${chunkSize} → ${next} octets`)
        chunkSize = next
      }
      lastDecision = 'keep'
    } else {
      lastDecision = decision
    }

    const knownAfter = total()
    if (knownAfter === null) {
      // No usable total ⇒ we cannot know when to stop; let the continuous engine
      // finish the tail.
      return {
        outcome: 'fallback',
        reason: 'taille totale inconnue',
        totalBytes: latchedTotal
      }
    }
    if (offset >= knownAfter) {
      return { outcome: 'done', totalBytes: latchedTotal }
    }

    if (interBlockDelayMs > 0) await sleep(interBlockDelayMs)
  }
}
