/**
 * Connection & settings domain types.
 * Credentials (username/password) are NEVER stored in the SQLite settings table
 * and NEVER cross IPC inside a settings object except when explicitly setting them.
 */

/** Xtream connection credentials. Handled via encrypted safeStorage only. */
export interface XtreamCredentials {
  /** Base URL, e.g. "http://mon-panel.exemple:8080". No trailing slash. */
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
  /** Default reminder lead: notify this many seconds BEFORE a programme starts. */
  reminderLeadSecs: number
  /** Scheduled recording: start this many seconds BEFORE the programme start. */
  recordPadBeforeSecs: number
  /** Scheduled recording: stop this many seconds AFTER the programme end. */
  recordPadAfterSecs: number
  /**
   * Download in bounded RANGE BLOCKS (a fresh connection per block) instead of
   * one long connection. Providers pace a long streaming-style connection down
   * to roughly the media bitrate after an initial burst; re-requesting bounded
   * ranges keeps re-triggering that burst, which can be much faster. Falls back
   * to the continuous mode automatically if the server ignores bounded ranges.
   */
  chunkedDownloads: boolean
  /**
   * How many provider connections ONE download may use in parallel (1 = the
   * historical single-connection behaviour).
   *
   * The provider rate-limits each connection (~0.5 MiB/s observed), far below a
   * typical line, so N parallel bounded-range requests can multiply throughput.
   * MUST stay within the account's `max_connections` (visible in
   * Réglages → Connexion → Tester) and leave room for playback — hence a
   * conservative default and an explicit user choice.
   */
  downloadConnections: number
  /**
   * Size of ONE block in block mode, in bytes. THE throughput knob.
   *
   * Measured on the target provider: a connection is rate-limited to a dead flat
   * ~471 KiB/s, but each NEW connection is granted roughly 1 MiB before the
   * limiter engages. Every block opens a new connection, so a SMALL block
   * collects that allowance more often — 2 MiB blocks project to ~1.8x the
   * throughput of one long connection, while 32 MiB blocks are indistinguishable
   * from it. Adjustable because the allowance is provider-specific.
   */
  downloadBlockBytes: number
  /**
   * User-Agent used for media transfers. Some panels shape "browser" traffic
   * differently from player traffic, so this is switchable for testing.
   */
  downloadUserAgent: 'browser' | 'player'
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: null,
  filenameTemplate: '{title} ({year})',
  theme: 'dark',
  maxConcurrentDownloads: 1,
  diskSpaceWarningBytes: 2 * 1024 * 1024 * 1024, // 2 GiB
  pauseDownloadsWhilePlaying: true,
  lastSeenVersion: null,
  reminderLeadSecs: 120, // 2 min before start
  recordPadBeforeSecs: 60, // +1 min before
  recordPadAfterSecs: 120, // +2 min after
  chunkedDownloads: true, // block mode by default (auto-falls back when unsupported)
  downloadConnections: 1, // opt-in: raising this uses several provider connections
  downloadBlockBytes: 2 * 1024 * 1024, // small on purpose: more per-connection bursts
  downloadUserAgent: 'browser'
}

/** Whether a TMDB API key is stored (without revealing it). */
export interface TmdbKeyStatus {
  hasKey: boolean
  /** True if OS-level encryption (safeStorage) is available. */
  encryptionAvailable: boolean
}

/** Lightweight, non-secret app metadata exposed to the renderer. */
export interface AppInfo {
  /** Semantic version of the running app (from package.json). */
  version: string
}

/** Outcome of a manual "check for updates" request. */
export interface UpdateCheckOutcome {
  status:
    | 'dev-disabled' // not a packaged build → auto-update inactive
    | 'up-to-date' // already on the latest release
    | 'available' // a newer release exists; the USER decides to download/install
    | 'error' // the check failed (offline, no release, etc.)
  /** Version currently running. */
  currentVersion: string
  /** Latest version seen on the update feed, if known. */
  latestVersion?: string
  /** Human-readable detail for the UI. */
  message?: string
}

/**
 * Live app-update lifecycle pushed main -> renderer. Nothing downloads or
 * installs without the user's explicit go-ahead:
 *  - available   : a newer release exists (manual or background check)
 *  - downloading : the user accepted; progress ticks stream in
 *  - downloaded  : ready — the user can launch the visible (non-silent) installer
 *  - error       : the download failed
 */
export interface UpdateStatusEvent {
  phase: 'available' | 'downloading' | 'downloaded' | 'error'
  latestVersion?: string
  /** 0..100 while downloading. */
  percent?: number
  /** Instantaneous download speed (bytes/sec) while downloading. */
  bytesPerSecond?: number
  message?: string
}
