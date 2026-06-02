/**
 * Pure helpers for the download engine, extracted from DownloadManager so they
 * can be unit-tested in isolation (no undici / SQLite / Electron imports).
 * Behaviour is identical to the previous in-file definitions.
 */

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
