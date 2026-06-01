/**
 * Common shared types used across main / preload / renderer.
 * SOURCE OF TRUTH — do not duplicate these elsewhere.
 */

/**
 * Standard envelope returned by every request-style IPC handler.
 * Handlers never throw across the IPC boundary; they return a Result instead,
 * so the renderer can always discriminate success vs. failure type-safely.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }

export interface AppError {
  /** Stable, machine-readable code (see {@link ErrorCode}). */
  code: ErrorCode
  /** Human-readable message (safe to display; never contains secrets). */
  message: string
  /** Optional extra context for logging/diagnostics. */
  details?: string
}

export type ErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_INPUT'
  | 'NOT_CONNECTED'
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'CONNECTION_BUSY'
  | 'DISK_ERROR'
  | 'DB_ERROR'
  | 'PLAYER_ERROR'
  | 'UNKNOWN'

/** Generic pagination request. */
export interface PageRequest {
  /** 1-based page index. */
  page: number
  /** Items per page. */
  pageSize: number
}

/** Generic paginated response. */
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/** Helper constructors (main-process side may import these). */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err(code: ErrorCode, message: string, details?: string): Result<never> {
  return { ok: false, error: { code, message, details } }
}

export function notImplemented(what: string): Result<never> {
  return err('NOT_IMPLEMENTED', `${what} is not implemented yet (stub).`)
}
