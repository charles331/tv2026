/**
 * Lightweight application journal — domain types.
 *
 * The main process keeps a bounded in-memory ring buffer (for the Réglages
 * viewer) and appends to a small rotating file under userData/logs (for
 * post-crash diagnosis). Messages are scrubbed of credentials/stream secrets
 * BEFORE being stored (see main/log/scrub.ts).
 */

export type LogLevel = 'info' | 'warn' | 'error'

/** One journal line as shown in the Réglages viewer. */
export interface LogEntry {
  /** Monotonic id (per app session). */
  id: number
  /** Unix epoch milliseconds. */
  tsMs: number
  level: LogLevel
  /** Emitting domain, e.g. "player", "downloads", "updater", "app", "ui". */
  scope: string
  message: string
}

/** Request for the journal viewer (newest entries win when limit trims). */
export interface ListLogsRequest {
  /** Max entries returned (default 500). */
  limit?: number
  /** Keep only this level ('all' or omitted = everything). */
  level?: LogLevel | 'all'
}

/** Renderer-side log append (global error handlers, notable UI failures). */
export interface WriteLogRequest {
  level: LogLevel
  scope: string
  message: string
}
