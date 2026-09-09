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

// ---------------------------------------------------------------- block mode

/**
 * Block size for the block-download mode, and the choices offered in Réglages.
 *
 * Measured on the target provider: a long connection is rate-limited to a dead
 * flat ~471 KiB/s, and 30 s windows containing a block boundary read ~510 KiB/s
 * while windows entirely inside a block read ~471 KiB/s — identical to the
 * continuous mode. In other words each NEW connection is granted roughly 1 MiB
 * of un-throttled data before the limiter engages.
 *
 * So the block size is exactly the knob that matters: SMALL blocks reconnect
 * more often and collect that allowance more often. A previous adaptive
 * controller tried to infer the size from in-block throughput and made it grow
 * to 36 MiB — one boundary every ~78 s, which dilutes the allowance to nothing.
 * A flat rate limiter gives it no signal to work with, so it was replaced by an
 * explicit, user-testable setting: simpler, and it cannot drift the wrong way.
 */
export const BLOCK_SIZE_DEFAULT_BYTES = 2 * 1024 * 1024
export const BLOCK_SIZE_MIN_BYTES = 1024 * 1024
export const BLOCK_SIZE_MAX_BYTES = 64 * 1024 * 1024

/** Sizes offered in Réglages → Téléchargements (bytes). */
export const BLOCK_SIZE_CHOICES = [
  1024 * 1024,
  2 * 1024 * 1024,
  4 * 1024 * 1024,
  8 * 1024 * 1024,
  16 * 1024 * 1024,
  32 * 1024 * 1024
] as const

/** Clamp a requested block size into the allowed range. */
export function clampBlockSize(bytes: number, min?: number, max?: number): number {
  const lo = min ?? BLOCK_SIZE_MIN_BYTES
  const hi = max ?? BLOCK_SIZE_MAX_BYTES
  if (!Number.isFinite(bytes)) return BLOCK_SIZE_DEFAULT_BYTES
  return Math.max(lo, Math.min(hi, Math.floor(bytes)))
}

/**
 * Windows file-lock error codes. An antivirus or the search indexer can hold the
 * `.part` file open for a few seconds, which fails an append with EBUSY. That is
 * a LOCAL, self-clearing condition — nothing to do with the provider — so it
 * gets its own retry budget instead of consuming the network one.
 */
const TRANSIENT_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE'])

/** True when an error is a transient local file lock rather than a transfer failure. */
export function isTransientLockError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && TRANSIENT_LOCK_CODES.has(code)
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

/**
 * Raised when a transfer would (or did) compromise file integrity — a block that
 * does not start where the `.part` ends, or a remote file whose size changed
 * mid-download. Always terminal: never retried, never finalized.
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

/** Map a transfer error to a human-readable, renderer-safe message. */
export function describeError(e: unknown): string {
  // Already a precise, user-facing French message.
  if (e instanceof IntegrityError) return e.message
  if (e instanceof HttpStatusError) {
    if (e.statusCode === 401 || e.statusCode === 403 || e.statusCode === 512) {
      return 'Identification refusée ou jeton de téléchargement expiré'
    }
    if (e.statusCode === 404) return 'Fichier introuvable chez le fournisseur'
    return `Le fournisseur a répondu HTTP ${e.statusCode}`
  }
  const err = e as NodeJS.ErrnoException
  if (err?.code === 'ENOSPC') return 'Disque plein — plus de place pour continuer'
  if (err?.code === 'ENOENT') return 'Le dossier de destination est introuvable'
  if (err?.code === 'EACCES' || err?.code === 'EPERM') {
    return 'Écriture refusée dans le dossier de destination'
  }
  if (err?.code === 'ECONNRESET') return 'Connexion coupée par le fournisseur'
  if (err?.code === 'ETIMEDOUT') return 'Délai dépassé pendant le transfert'
  if (err?.name === 'ConnectTimeoutError' || err?.name === 'HeadersTimeoutError') {
    return 'Le fournisseur ne répond pas (délai dépassé)'
  }
  if (err?.message) return `Erreur de téléchargement : ${err.message}`
  return 'Erreur de téléchargement inconnue'
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
