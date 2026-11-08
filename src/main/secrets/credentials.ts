/**
 * Encrypted Xtream credential storage via Electron safeStorage.
 *
 * Security rules:
 *  - The password is encrypted with the OS keychain (safeStorage) and written
 *    as an opaque blob to a file in userData. It NEVER touches SQLite or logs.
 *  - getCredentials() returns the decrypted creds for main-process use only;
 *    it must never be sent over IPC. The renderer only ever sees CredentialsStatus.
 *  - baseUrl + username are non-secret and stored alongside in plaintext JSON
 *    (only the password blob is encrypted).
 */

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { app, safeStorage } from 'electron'
import type { CredentialsStatus, XtreamCredentials } from '@shared/index'

interface StoredCredsFile {
  baseUrl: string
  username: string
  /** base64 of the safeStorage-encrypted password buffer. */
  passwordEnc: string
}

/**
 * DEV ONLY: credentials from the repo's `.env` (XTREAM_URL / XTREAM_USER /
 * XTREAM_PASS), so the app can be launched and driven end-to-end (Playwright)
 * without typing them into the UI. Never active in a packaged build, never
 * written anywhere, and only used when nothing is stored via safeStorage.
 */
let devEnvCache: XtreamCredentials | null | undefined
function devEnvCredentials(): XtreamCredentials | null {
  if (devEnvCache !== undefined) return devEnvCache
  devEnvCache = null
  if (app.isPackaged) return null
  const env: Record<string, string | undefined> = { ...process.env }
  // `electron-vite dev` runs with the repo as app path; `electron out/main/index.js`
  // (Playwright) with out/main — look a couple of levels up for the repo's .env.
  const appPath = app.getAppPath()
  const file = [appPath, join(appPath, '..'), join(appPath, '..', '..')]
    .map((d) => join(d, '.env'))
    .find((f) => existsSync(f))
  if (file) {
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && env[m[1]!] === undefined) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const baseUrl = env['XTREAM_URL'], username = env['XTREAM_USER'], password = env['XTREAM_PASS']
  if (baseUrl && username && password) {
    devEnvCache = { baseUrl: normalizeBaseUrl(baseUrl), username: username.trim(), password }
  }
  return devEnvCache
}

function credsPath(): string {
  return join(app.getPath('userData'), 'credentials.json')
}

/** Normalize a base URL: strip trailing slashes. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function readFile(): StoredCredsFile | null {
  const p = credsPath()
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as StoredCredsFile
  } catch {
    return null
  }
}

/** True if OS-level encryption is available (always check before setting). */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Persist credentials. The password is encrypted with safeStorage.
 * Throws if encryption is unavailable (caller maps to an AppError).
 */
export function setCredentials(creds: XtreamCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (safeStorage) is not available on this system.')
  }
  const enc = safeStorage.encryptString(creds.password)
  const file: StoredCredsFile = {
    baseUrl: normalizeBaseUrl(creds.baseUrl),
    username: creds.username.trim(),
    passwordEnc: enc.toString('base64')
  }
  writeFileSync(credsPath(), JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
}

/**
 * Decrypt and return full credentials for MAIN-PROCESS use only.
 * Returns null if none stored or decryption fails. NEVER send over IPC.
 */
export function getCredentials(): XtreamCredentials | null {
  const file = readFile()
  if (!file) return devEnvCredentials()
  try {
    const buf = Buffer.from(file.passwordEnc, 'base64')
    const password = safeStorage.decryptString(buf)
    return { baseUrl: file.baseUrl, username: file.username, password }
  } catch {
    return null
  }
}

/** Remove stored credentials. */
export function clearCredentials(): void {
  const p = credsPath()
  if (existsSync(p)) rmSync(p)
}

/** Non-secret status safe to expose to the renderer. */
export function getCredentialsStatus(): CredentialsStatus {
  const file = readFile()
  const dev = file ? null : devEnvCredentials()
  return {
    hasCredentials: file !== null || dev !== null,
    baseUrl: file?.baseUrl ?? dev?.baseUrl ?? null,
    username: file?.username ?? dev?.username ?? null,
    encryptionAvailable: isEncryptionAvailable()
  }
}
