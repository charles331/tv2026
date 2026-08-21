/**
 * Pure helpers for the download engine, extracted from DownloadManager so they
 * can be unit-tested in isolation (no undici / SQLite / Electron imports — only
 * Node's fs builtin for the rename retry below).
 */

import { rename as fsRename } from 'fs/promises'
import { join } from 'path'

import { assertPathWithin } from '../ipc/validate'

/** Raised when the provider answers an unexpected (non-2xx/206) HTTP status. */
export class HttpStatusError extends Error {
  constructor(readonly statusCode: number) {
    super(`provider returned HTTP ${statusCode}`)
    this.name = 'HttpStatusError'
  }
}

/** The temp filename a download streams into before its atomic final rename. */
export function partPath(finalPath: string): string {
  return `${finalPath}.part`
}

/**
 * Media category whose files get their own subfolder under the configured
 * download directory. 'movie'/'series' come from the download queue; 'live' is
 * used by the player's live recording feature.
 */
export type MediaFolderKind = 'movie' | 'series' | 'live'

/**
 * Name of the subfolder (inside the download directory) where a given media kind
 * is stored, so the library stays organized: Films / Séries / Live. Keeping this
 * pure (and unit-tested) guarantees the same mapping is used by the download
 * engine and the live recorder.
 */
export function downloadSubfolder(kind: MediaFolderKind): string {
  switch (kind) {
    case 'series':
      return 'Séries'
    case 'live':
      return 'Live'
    case 'movie':
    default:
      return 'Films'
  }
}

/**
 * Sanitize a filename for the Windows filesystem: strip reserved characters
 * (\ / : * ? " < > |) plus control chars, collapse whitespace, and trim. Falls
 * back to `fallback` when the result is empty.
 */
export function sanitizeFileName(name: string, fallback = 'download'): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned || fallback
}

/** Filesystem-safe local timestamp for recording filenames: "2026-06-03 14-30-05". */
export function recordingTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  )
}

/**
 * Build the confined destination path for a LIVE recording:
 * `<downloadDir>/<Live>/<sanitized base> <timestamp>.ts`, asserted to stay
 * within the download directory. Shared by the interactive recording handler
 * and the scheduled RecordingController so the naming/confinement rule lives in
 * one place.
 */
export function buildLiveRecordingPath(downloadDir: string, baseName: string): string {
  const file = `${sanitizeFileName(baseName, 'Enregistrement')} ${recordingTimestamp()}.ts`
  return assertPathWithin(join(downloadDir, downloadSubfolder('live'), file), downloadDir)
}

// ---------------------------------------------------------------- chunked mode

/** Block-mode bounds: start at 8 MiB, adapt within [2, 64] MiB. */
export const CHUNK_INITIAL_BYTES = 8 * 1024 * 1024
export const CHUNK_MIN_BYTES = 2 * 1024 * 1024
export const CHUNK_MAX_BYTES = 64 * 1024 * 1024

/**
 * Adapt the next block size from the throughput measured INSIDE the block.
 *
 * Providers serve an initial burst at full speed then pace the connection down
 * to roughly the media bitrate. Comparing the first half of a block against its
 * second half detects whether the burst ended mid-block:
 *  - second half much slower  → the block outlived the burst → shrink;
 *  - second half still fast   → the whole block rode the burst → grow;
 *  - in between               → keep (we're near the sweet spot).
 *
 * Pure: same inputs → same output (unit-tested).
 */
export function nextChunkSize(opts: {
  current: number
  firstHalfBps: number
  secondHalfBps: number
  minBytes?: number
  maxBytes?: number
}): number {
  const min = opts.minBytes ?? CHUNK_MIN_BYTES
  const max = opts.maxBytes ?? CHUNK_MAX_BYTES
  const clamp = (n: number): number => Math.max(min, Math.min(max, Math.floor(n)))
  // No usable measurement (block too small / instant) → leave it alone.
  if (!(opts.firstHalfBps > 0) || !(opts.secondHalfBps >= 0)) return clamp(opts.current)
  const ratio = opts.secondHalfBps / opts.firstHalfBps
  if (ratio < 0.6) return clamp(opts.current * 0.7)
  if (ratio >= 0.85) return clamp(opts.current * 1.5)
  return clamp(opts.current)
}

/** Read a single header value (undici may surface a header as string[]). */
export function headerValue(h: string | string[] | undefined): string | undefined {
  if (Array.isArray(h)) return h[0]
  return h
}

/** Parse the total length out of `Content-Range: bytes 200-1023/1234`. */
export function parseContentRangeTotal(cr: string | undefined): number | null {
  if (!cr) return null
  const m = /\/(\d+)\s*$/.exec(cr.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parse the START offset out of `Content-Range: bytes 200-1023/1234`.
 *
 * The block engine MUST verify this: appending a block that does not actually
 * start where our `.part` ends would silently corrupt the file.
 */
export function parseContentRangeStart(cr: string | undefined): number | null {
  if (!cr) return null
  const m = /bytes\s+(\d+)\s*-/i.exec(cr.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Map a transfer error to a human-readable, renderer-safe message. */
export function describeError(e: unknown): string {
  if (e instanceof HttpStatusError) {
    if (e.statusCode === 401 || e.statusCode === 403 || e.statusCode === 512) {
      return 'Authentication failed or the download token expired. Try again.'
    }
    if (e.statusCode === 404) return 'The movie file was not found on the provider.'
    return `Provider returned HTTP ${e.statusCode}.`
  }
  const err = e as NodeJS.ErrnoException
  if (err?.code === 'ENOSPC') return 'Disk full — no space left to continue the download.'
  if (err?.code === 'ENOENT') return 'Destination path is unavailable.'
  if (err?.code === 'EACCES') return 'Permission denied writing to the destination.'
  if (err?.name === 'ConnectTimeoutError' || err?.name === 'HeadersTimeoutError') {
    return 'Network timeout reaching the provider.'
  }
  if (err?.message) return `Download error: ${err.message}`
  return 'Unknown download error.'
}

/** Format a byte count with binary units, e.g. "64.0 MiB" (disk-space messages). */
export function formatBytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

/**
 * Filesystem error codes that, on Windows, usually mean a freshly-written file
 * is briefly locked by another process (antivirus scan, Windows Search indexer)
 * rather than a permanent failure — so a rename should be retried.
 */
const TRANSIENT_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export interface RenameRetryOptions {
  /** Total attempts before giving up (default 10). */
  attempts?: number
  /** Base backoff in ms; doubles each retry up to maxDelayMs (default 200). */
  baseDelayMs?: number
  /** Cap on a single backoff delay (default 3000). */
  maxDelayMs?: number
  /** Injectable for tests; defaults to fs.promises.rename. */
  renameFn?: (from: string, to: string) => Promise<void>
  /** Injectable for tests; defaults to setTimeout-based sleep. */
  sleepFn?: (ms: number) => Promise<void>
}

/**
 * Rename with retry/backoff to survive transient Windows file locks (EBUSY /
 * EPERM / EACCES) right after a large download finishes — typically antivirus
 * or the search indexer holding the new file for a moment. Non-transient errors
 * (e.g. ENOSPC) are thrown immediately. Gives up after `attempts`, re-throwing
 * the last error so the caller can mark the download failed (the .part is kept).
 */
export async function renameWithRetry(
  from: string,
  to: string,
  opts: RenameRetryOptions = {}
): Promise<void> {
  const attempts = opts.attempts ?? 10
  const baseDelayMs = opts.baseDelayMs ?? 200
  const maxDelayMs = opts.maxDelayMs ?? 3000
  const renameFn = opts.renameFn ?? fsRename
  const sleepFn = opts.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (let i = 0; i < attempts; i++) {
    try {
      await renameFn(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      const transient = code !== undefined && TRANSIENT_RENAME_CODES.has(code)
      if (!transient || i === attempts - 1) throw e
      await sleepFn(Math.min(maxDelayMs, baseDelayMs * 2 ** i))
    }
  }
}
