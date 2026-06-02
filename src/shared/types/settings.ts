/**
 * Connection & settings domain types.
 * Credentials (username/password) are NEVER stored in the SQLite settings table
 * and NEVER cross IPC inside a settings object except when explicitly setting them.
 */

/** Xtream connection credentials. Handled via encrypted safeStorage only. */
export interface XtreamCredentials {
  /** Base URL, e.g. "http://2026.tarik.buzz:8080". No trailing slash. */
  baseUrl: string
  username: string
  password: string
}

/** Whether credentials are currently stored (without revealing them). */
export interface CredentialsStatus {
  hasCredentials: boolean
  /** Base URL is non-secret and may be surfaced for display/prefill. */
  baseUrl: string | null
  username: string | null
  /** True if OS-level encryption (safeStorage) is available. */
  encryptionAvailable: boolean
}

/** Result of testing the Xtream connection (account info subset). */
export interface ConnectionTestResult {
  status: 'active' | 'expired' | 'banned' | 'disabled' | 'unknown'
  /** Unix epoch seconds, or null if unlimited/unknown. */
  expiresAt: number | null
  /** Max simultaneous connections reported by the server (expected: 1). */
  maxConnections: number | null
  activeConnections: number | null
  /** Trial account flag, if reported. */
  isTrial: boolean | null
}

/** Non-secret application settings (persisted in SQLite `settings` table). */
export interface AppSettings {
  /** Absolute path of the download directory (Windows path at runtime). */
  downloadDir: string | null
  /** Filename template, e.g. "{title} ({year})". */
  filenameTemplate: string
  /** Theme preference. */
  theme: 'dark' | 'light' | 'system'
  /** Max concurrent downloads — forced to 1 by the 1-connection constraint. */
  maxConcurrentDownloads: 1
  /** Warn when free disk space drops below this many bytes. */
  diskSpaceWarningBytes: number
  /** Auto-pause downloads while the player is streaming. Always true (constraint). */
  pauseDownloadsWhilePlaying: boolean
  /**
   * Last app version for which the user has seen the changelog. Drives the
   * "what's new" badge after an update. `null` until first set; a fresh install
   * is silently pinned to the current version so no badge shows on day one.
   */
  lastSeenVersion: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: null,
  filenameTemplate: '{title} ({year})',
  theme: 'dark',
  maxConcurrentDownloads: 1,
  diskSpaceWarningBytes: 2 * 1024 * 1024 * 1024, // 2 GiB
  pauseDownloadsWhilePlaying: true,
  lastSeenVersion: null
}

/** Lightweight, non-secret app metadata exposed to the renderer. */
export interface AppInfo {
  /** Semantic version of the running app (from package.json). */
  version: string
}
