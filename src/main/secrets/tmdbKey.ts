/**
 * Encrypted TMDB API key storage via Electron safeStorage.
 *
 * Mirrors secrets/credentials.ts: the key is encrypted with the OS keychain and
 * written as an opaque blob to a file in userData. It NEVER touches SQLite or
 * logs, and getTmdbKey() (decrypted) is for MAIN-PROCESS use only — the renderer
 * only ever sees TmdbKeyStatus (a boolean), never the key itself.
 */

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { app, safeStorage } from 'electron'
import type { TmdbKeyStatus } from '@shared/index'

interface StoredTmdbFile {
  /** base64 of the safeStorage-encrypted API key buffer. */
  keyEnc: string
}

function keyPath(): string {
  return join(app.getPath('userData'), 'tmdb.json')
}

function readFile(): StoredTmdbFile | null {
  const p = keyPath()
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as StoredTmdbFile
  } catch {
    return null
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Persist the TMDB key, encrypted with safeStorage. An empty/whitespace key
 * clears it. Throws if encryption is unavailable (caller maps to an AppError).
 */
export function setTmdbKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    clearTmdbKey()
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (safeStorage) is not available on this system.')
  }
  const enc = safeStorage.encryptString(trimmed)
  const file: StoredTmdbFile = { keyEnc: enc.toString('base64') }
  writeFileSync(keyPath(), JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
}

/**
 * Decrypt and return the TMDB key for MAIN-PROCESS use only.
 * Returns null if none stored or decryption fails. NEVER send over IPC.
 */
export function getTmdbKey(): string | null {
  const file = readFile()
  if (!file) return null
  try {
    const buf = Buffer.from(file.keyEnc, 'base64')
    const key = safeStorage.decryptString(buf)
    return key.trim() || null
  } catch {
    return null
  }
}

/** Remove the stored TMDB key. */
export function clearTmdbKey(): void {
  const p = keyPath()
  if (existsSync(p)) rmSync(p)
}

/** Non-secret status safe to expose to the renderer. */
export function getTmdbKeyStatus(): TmdbKeyStatus {
  return {
    hasKey: readFile() !== null,
    encryptionAvailable: isEncryptionAvailable()
  }
}
