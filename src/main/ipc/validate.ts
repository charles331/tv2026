/**
 * Minimal runtime validation for IPC inputs. The IPC boundary is a trust
 * boundary even with contextIsolation, so every handler validates its request
 * before use. These helpers throw on failure; registerHandlers() catches and
 * maps to an INVALID_INPUT AppError.
 */

import { isAbsolute, relative, resolve } from 'path'

export class ValidationError extends Error {}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ValidationError(message)
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function requireString(obj: Record<string, unknown>, key: string, max = 4096): string {
  const v = obj[key]
  assert(typeof v === 'string', `"${key}" must be a string`)
  assert((v as string).length <= max, `"${key}" too long`)
  return v as string
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  max = 4096
): string | undefined {
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  assert(typeof v === 'string', `"${key}" must be a string`)
  assert((v as string).length <= max, `"${key}" too long`)
  return v as string
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key]
  assert(typeof v === 'number' && Number.isFinite(v), `"${key}" must be a finite number`)
  return v as number
}

export function requireInt(obj: Record<string, unknown>, key: string): number {
  const v = requireNumber(obj, key)
  assert(Number.isInteger(v), `"${key}" must be an integer`)
  return v
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  assert(typeof v === 'number' && Number.isFinite(v), `"${key}" must be a finite number`)
  return v as number
}

export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  assert(typeof v === 'boolean', `"${key}" must be a boolean`)
  return v as boolean
}

export function requireBaseUrl(obj: Record<string, unknown>, key: string): string {
  const v = requireString(obj, key)
  assert(/^https?:\/\/.+/i.test(v), `"${key}" must be an http(s) URL`)
  return v
}

/**
 * Validate that `filePath` is an absolute path confined within `baseDir`
 * (defends against path traversal / arbitrary local file access from the
 * renderer). Returns the resolved absolute path. Throws ValidationError on any
 * violation. `baseDir` must itself be an absolute, configured directory.
 */
export function assertPathWithin(filePath: string, baseDir: string): string {
  assert(typeof filePath === 'string' && filePath.length > 0, 'filePath must be a non-empty string')
  assert(filePath.length <= 4096, 'filePath too long')
  // Reject NUL bytes outright (can truncate paths in native calls).
  // eslint-disable-next-line no-control-regex
  assert(!/\x00/.test(filePath), 'filePath contains invalid characters')
  assert(isAbsolute(filePath), 'filePath must be absolute')
  assert(isAbsolute(baseDir), 'download directory is not configured as an absolute path')

  const resolvedBase = resolve(baseDir)
  const resolvedPath = resolve(filePath)
  const rel = relative(resolvedBase, resolvedPath)
  // Confined iff the relative path does not escape (no leading '..') and is not absolute.
  assert(
    rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)),
    'filePath must be inside the configured download directory'
  )
  return resolvedPath
}
