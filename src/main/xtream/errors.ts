/**
 * Typed error surface for the Xtream client.
 *
 * The client NEVER throws across the IPC boundary — but internally it throws
 * these typed errors, which the IPC handlers catch and convert into the shared
 * `Result` error envelope (`err(code, message)`), mapping XtreamErrorKind onto
 * the shared ErrorCode union. This keeps provider quirks (auth:0, malformed
 * JSON, expired token) out of the renderer as clean, machine-readable codes.
 */

import type { ErrorCode } from '@shared/index'

export type XtreamErrorKind =
  | 'AUTH_FAILED' // auth:0, banned, disabled, or expired account
  | 'NETWORK_ERROR' // DNS / connect / timeout / non-2xx
  | 'MALFORMED' // unparseable or unexpected response body
  | 'NOT_FOUND' // requested resource absent (e.g. unknown vod_id)
  | 'NO_CREDENTIALS' // no stored credentials to use

export class XtreamError extends Error {
  readonly kind: XtreamErrorKind
  readonly details?: string

  constructor(kind: XtreamErrorKind, message: string, details?: string) {
    super(message)
    this.name = 'XtreamError'
    this.kind = kind
    this.details = details
  }
}

/** Map an internal XtreamErrorKind to the shared IPC ErrorCode. */
export function toErrorCode(kind: XtreamErrorKind): ErrorCode {
  switch (kind) {
    case 'AUTH_FAILED':
      return 'AUTH_FAILED'
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR'
    case 'NOT_FOUND':
      return 'NOT_FOUND'
    case 'NO_CREDENTIALS':
      return 'NOT_CONNECTED'
    case 'MALFORMED':
      return 'UNKNOWN'
    default:
      return 'UNKNOWN'
  }
}
