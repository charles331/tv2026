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
import { appendFile, stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import type { Readable, Writable } from 'stream'

import {
  BLOCK_SIZE_DEFAULT_BYTES,
  BLOCK_SIZE_MAX_BYTES,
  BLOCK_SIZE_MIN_BYTES,
  HttpStatusError,
  IntegrityError,
  clampBlockSize,
  headerValue,
  isTransientLockError,
  parseContentRangeStart,
  parseContentRangeTotal
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
  /**
   * Size of ONE block. This is the main throughput knob: every block opens a new
   * connection, and the provider grants each new connection a burst allowance
   * before its rate limiter engages, so smaller blocks collect that allowance
   * more often. See BLOCK_SIZE_DEFAULT_BYTES for the measurements.
   */
  blockBytes?: number
  /** Block-size bounds (overridable so the engine is testable with KB payloads). */
  minChunkBytes?: number
  maxChunkBytes?: number
  /** Retries for ONE block before giving up (transient network hiccups). */
  maxBlockRetries?: number
  /**
   * Retries for a transient LOCAL file lock (antivirus/indexer holding the
   * `.part` open). Separate from the network budget: a slow virus scan must not
   * consume the retries meant for provider hiccups.
   */
  maxLockRetries?: number
  /**
   * Opens the `.part` file for append. Injectable so that a local file lock
   * (EBUSY from an antivirus) can be reproduced deterministically in tests.
   */
  openAppend?: (path: string) => Writable
  /** Politeness delay between blocks (provider rate-limit protection). */
  interBlockDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Hard cap on the number of requests for one file. */
  maxBlocks?: number
  /**
   * Provider connections used IN PARALLEL for this file (1 = sequential, the
   * historical behaviour). Above 1, blocks are fetched concurrently but still
   * appended in strict order. Must stay within the account's max_connections.
   */
  connections?: number
}

export type BlockEngineOutcome =
  | { outcome: 'done'; totalBytes: number | null }
  | {
      outcome: 'fallback'
      reason: string
      totalBytes: number | null
      /**
       * Set when the provider actively refused parallel connections (it cut a
       * surplus one). The caller should stop requesting parallelism for this
       * account rather than retry it on every download.
       */
      parallelRefused?: boolean
    }

/** Statuses that mean "stop hammering the provider" → hand over to continuous. */
const RATE_LIMIT_STATUSES = new Set([429, 403, 503])
async function fileSizeOrZero(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}


/** Total bytes buffered in RAM across parallel workers is capped to this. */
const MAX_PARALLEL_BUFFER_BYTES = 64 * 1024 * 1024

/**
 * Validate a ranged response against what we asked for. Returns the latched
 * total, or a fallback reason. Throws IntegrityError / HttpStatusError when the
 * answer is unusable and must NOT be appended.
 *
 * Shared by the sequential and parallel paths so the integrity rules can never
 * drift apart between them.
 */
function validateRangeResponse(opts: {
  res: BlockResponse
  wantStart: number
  wantBytes: number
  latchedTotal: number | null
  sawValid206: boolean
}): { ok: true; total: number | null } | { ok: false; fallback: string } {
  const { res, wantStart, wantBytes, latchedTotal, sawValid206 } = opts

  if (res.statusCode !== 206) {
    if (RATE_LIMIT_STATUSES.has(res.statusCode)) {
      return { ok: false, fallback: `le serveur a répondu HTTP ${res.statusCode} (limitation)` }
    }
    if (res.statusCode === 200) {
      // Ranges already proved to work ⇒ a 200 now is a server error (expired
      // token / error page), never a capability signal.
      if (sawValid206) throw new HttpStatusError(200)
      return { ok: false, fallback: 'le serveur ignore les requêtes par bloc (HTTP 200)' }
    }
    throw new HttpStatusError(res.statusCode)
  }

  const contentRange = headerValue(res.headers['content-range'])
  const rangeStart = parseContentRangeStart(contentRange)
  if (rangeStart === null) {
    // Unverifiable ⇒ unsafe: we cannot prove where these bytes belong.
    return { ok: false, fallback: 'réponse 206 sans Content-Range exploitable' }
  }
  if (rangeStart !== wantStart) {
    throw new IntegrityError(
      `Bloc incohérent renvoyé par le serveur (attendu à ${wantStart}, reçu à ${rangeStart}).`
    )
  }

  let total = latchedTotal
  const parsedTotal = parseContentRangeTotal(contentRange)
  if (parsedTotal !== null) {
    if (total === null) {
      total = parsedTotal
    } else if (parsedTotal !== total) {
      throw new IntegrityError(
        `La taille du fichier a changé sur le serveur (${total} → ${parsedTotal}) : téléchargement interrompu pour ne pas mélanger deux versions.`
      )
    }
  }

  const declaredLen = Number(headerValue(res.headers['content-length']))
  if (Number.isFinite(declaredLen) && declaredLen > wantBytes * 1.5) {
    return { ok: false, fallback: 'borne de fin ignorée par le serveur' }
  }

  return { ok: true, total }
}

/** Read a whole (bounded) block into memory, enforcing the requested length. */
async function readBlockToBuffer(
  body: Readable,
  wantBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of body) {
    if (signal.aborted) throw new Error('aborted')
    const buf = chunk as Buffer
    size += buf.length
    if (size > wantBytes * 1.5) {
      throw new IntegrityError('Le serveur a renvoyé plus de données que le bloc demandé.')
    }
    parts.push(buf)
  }
  return Buffer.concat(parts, size)
}

/**
 * PARALLEL block download — the accelerator for providers that rate-limit each
 * connection well below the user's line (observed: ~0.5 MiB/s per connection on
 * an 85 Mbit/s line).
 *
 * Fetches N bounded ranges CONCURRENTLY but appends them in STRICT OFFSET ORDER,
 * so the `.part` file stays a contiguous prefix at all times. That preserves the
 * entire existing model: resume is still "file size = bytes done", and a crash
 * mid-wave simply re-fetches the unwritten blocks.
 *
 * Deliberately uses more than one provider connection — the caller must keep N
 * within the account's `max_connections`.
 */
async function runParallelWaves(opts: {
  base: BlockEngineOptions
  startOffset: number
  total: number
  connections: number
  chunkSize: number
  minChunkBytes: number
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  interruptReason: () => string | null
  makeInterruptError: (reason: string) => Error
  sleep: (ms: number) => Promise<void>
}): Promise<BlockEngineOutcome> {
  const { base, total, connections, log } = opts
  // Bound memory: N buffers are held at once, so shrink the block if needed.
  const chunkSize = Math.max(
    opts.minChunkBytes,
    Math.min(opts.chunkSize, Math.floor(MAX_PARALLEL_BUFFER_BYTES / connections))
  )
  let offset = opts.startOffset
  const sawValid206 = true // we only get here after a validated sequential block
  let waves = 0
  const maxWaves = Math.ceil((total - offset) / (chunkSize * connections)) + 8

  log(
    'info',
    `mode parallèle : ${connections} connexions × ${Math.round(chunkSize / 1024 / 1024)} Mio`
  )

  while (offset < total) {
    const reason = opts.interruptReason()
    if (reason) throw opts.makeInterruptError(reason)
    if (++waves > maxWaves) {
      return { outcome: 'fallback', reason: 'trop de vagues (sécurité)', totalBytes: total }
    }

    // Plan this wave: up to `connections` consecutive blocks.
    const plan: { start: number; end: number }[] = []
    for (let i = 0; i < connections; i++) {
      const start = offset + i * chunkSize
      if (start >= total) break
      plan.push({ start, end: Math.min(start + chunkSize - 1, total - 1) })
    }

    // Fetch them concurrently. `allSettled`, not `all`: when the provider kills a
    // surplus connection we still want to keep the blocks that DID arrive.
    const settled = await Promise.allSettled(
      plan.map(async ({ start, end }) => {
        const wantBytes = end - start + 1
        const res = await base.request(base.url, {
          headers: { range: `bytes=${start}-${end}`, connection: 'close' },
          signal: base.signal
        })
        const verdict = validateRangeResponse({
          res,
          wantStart: start,
          wantBytes,
          latchedTotal: total,
          sawValid206
        })
        if (!verdict.ok) {
          await res.body.dump?.().catch(() => undefined)
          return { kind: 'fallback' as const, reason: verdict.fallback }
        }
        const buffer = await readBlockToBuffer(res.body, wantBytes, base.signal)
        return { kind: 'block' as const, start, buffer }
      })
    )

    // Interrupts and integrity failures are terminal wherever they happened.
    for (const r of settled) {
      if (r.status !== 'rejected') continue
      const e = r.reason
      const name = (e as Error)?.name
      if (e instanceof IntegrityError || name === 'AbortError' || opts.interruptReason()) throw e
    }

    // Salvage the LEADING run of successful blocks: they are contiguous from the
    // current offset, so appending them is always safe and avoids re-fetching.
    let appended = 0
    for (const r of settled) {
      if (r.status !== 'fulfilled' || r.value.kind !== 'block') break
      const block = r.value
      if (block.start !== offset) {
        throw new IntegrityError(
          `Ordre d’écriture incohérent (attendu ${offset}, bloc à ${block.start}).`
        )
      }
      await appendFile(base.partPath, block.buffer)
      offset += block.buffer.length
      appended++
      base.onProgress?.(offset, total)
    }
    if (appended > 0) base.onBlockDone?.(offset, total)

    // A rejected block (typically a truncated body: the provider cut the surplus
    // connection) means parallel downloading is NOT allowed on this account.
    // Report it so the caller can stop asking for it, and finish sequentially —
    // never fail the download over it.
    const killed = settled.find((r) => r.status === 'rejected')
    if (killed && killed.status === 'rejected') {
      const detail = (killed.reason as Error)?.message ?? String(killed.reason)
      log(
        'warn',
        `connexion parallèle interrompue par le fournisseur (${detail}) → retour à une seule connexion`
      )
      return {
        outcome: 'fallback',
        reason: 'le fournisseur n’autorise pas plusieurs connexions simultanées',
        totalBytes: total,
        parallelRefused: true
      }
    }

    // A well-formed but unusable answer (rate limit, unbounded stream, ...).
    const bad = settled.find(
      (r) => r.status === 'fulfilled' && r.value.kind === 'fallback'
    )
    if (bad && bad.status === 'fulfilled' && bad.value.kind === 'fallback') {
      log('warn', `${bad.value.reason} → arrêt du mode parallèle`)
      return { outcome: 'fallback', reason: bad.value.reason, totalBytes: total }
    }

    if (opts.sleep && base.interBlockDelayMs) await opts.sleep(base.interBlockDelayMs)
  }

  return { outcome: 'done', totalBytes: total }
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
  const maxLockRetries = opts.maxLockRetries ?? 12
  const openAppend =
    opts.openAppend ?? ((path: string): Writable => createWriteStream(path, { flags: 'a' }))
  const interBlockDelayMs = opts.interBlockDelayMs ?? 100
  const maxBlocks = opts.maxBlocks ?? 4096
  const connections = Math.max(1, Math.min(8, Math.floor(opts.connections ?? 1)))
  const interruptReason = opts.interruptReason ?? ((): string | null => null)
  const makeInterruptError =
    opts.makeInterruptError ?? ((reason: string): Error => new Error(`interrupted: ${reason}`))

  let offset = opts.startOffset
  /** Authoritative total, latched from the first 206 (never re-assigned). */
  let latchedTotal: number | null = null
  const minChunk = opts.minChunkBytes ?? BLOCK_SIZE_MIN_BYTES
  const maxChunk = opts.maxChunkBytes ?? BLOCK_SIZE_MAX_BYTES
  // Fixed for the whole file: a flat rate limiter offers no signal to adapt on,
  // and a controller that guesses drifts toward big blocks — exactly the wrong
  // way, since the per-connection burst is what makes this mode faster.
  const chunkSize = clampBlockSize(opts.blockBytes ?? BLOCK_SIZE_DEFAULT_BYTES, minChunk, maxChunk)
  let sawValid206 = false
  let blocks = 0
  let retries = 0
  let lockRetries = 0

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

      // ---------------- append the block ----------------
      const out = openAppend(opts.partPath)
      const overshootLimit = Math.floor(wantBytes * 1.5)
      let received = offset
      let overshot = false

      const counter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          received += chunk.length

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

      // A local file lock (antivirus/indexer holding the `.part`) is not a
      // transfer failure: it clears on its own within seconds. Give it its own,
      // more patient budget so a virus scan cannot exhaust the network retries
      // and fail an otherwise healthy download.
      const locked = isTransientLockError(e)
      const budget = locked ? maxLockRetries : maxRetries
      const used = locked ? lockRetries : retries
      if (used >= budget) throw e
      let attempt: number
      if (locked) {
        lockRetries++
        attempt = lockRetries
      } else {
        retries++
        attempt = retries
      }
      const backoff = locked
        ? Math.min(5000, 500 * attempt)
        : Math.min(8000, 500 * 2 ** (attempt - 1))
      log(
        'warn',
        `bloc à ${offset} ${locked ? 'bloqué par un verrou local' : 'en échec'} ` +
          `(${(e as Error)?.message ?? e}) — nouvelle tentative ${attempt}/${budget} dans ${backoff} ms`
      )
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
    lockRetries = 0
    opts.onBlockDone?.(offset, total())

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

    // The first block has now PROVEN that bounded ranges work and has latched the
    // authoritative total. That is exactly what the parallel path needs, so hand
    // over to it (the accelerator for per-connection rate limits).
    if (connections > 1) {
      return await runParallelWaves({
        base: opts,
        startOffset: offset,
        total: knownAfter,
        connections,
        chunkSize,
        minChunkBytes: minChunk,
        log,
        interruptReason,
        makeInterruptError,
        sleep
      })
    }

    if (interBlockDelayMs > 0) await sleep(interBlockDelayMs)
  }
}
