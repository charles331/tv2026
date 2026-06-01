/**
 * Resolve the mpv executable to drive playback.
 *
 * Resolution order (first hit wins):
 *   1. Bundled Windows build under resources/bin/ (production) or the repo's
 *      resources/bin/win/ (dev). This is the shipping path — mpv.exe + DLLs are
 *      placed there by mpv-player-integrator and bundled via electron-builder's
 *      extraResources (see electron-builder.yml).
 *   2. The system PATH (`mpv` / `mpv.exe`), useful for development on a host
 *      that already has mpv installed.
 *
 * If neither is found, callers surface a typed PLAYER_ERROR ("mpv introuvable")
 * so the UI shows a clear message instead of crashing.
 *
 * NOTE (WSL2 dev): mpv is not installed in this environment, so resolution will
 * usually fall through to "not found" here — that is expected. On the Windows
 * target the bundled binary is found at process.resourcesPath/bin/mpv.exe.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'

/** mpv executable name for the current platform. */
function mpvExeName(): string {
  return process.platform === 'win32' ? 'mpv.exe' : 'mpv'
}

/**
 * Candidate locations for a bundled mpv binary.
 *  - Packaged: process.resourcesPath/bin/mpv.exe (extraResources `to: bin`).
 *  - Dev: the repo's resources/bin/win/mpv.exe relative to app path.
 */
function bundledCandidates(): string[] {
  const exe = mpvExeName()
  const out: string[] = []
  // Packaged app: extraResources copies resources/bin/win/* -> <resources>/bin/*
  if (process.resourcesPath) {
    out.push(join(process.resourcesPath, 'bin', exe))
  }
  // Dev (electron-vite): app.getAppPath() points at the project; the Windows
  // build is conventionally staged under resources/bin/win/.
  try {
    const appPath = app.getAppPath()
    out.push(join(appPath, 'resources', 'bin', 'win', exe))
    out.push(join(appPath, '..', 'resources', 'bin', 'win', exe))
  } catch {
    // app may be unavailable in non-Electron contexts (tests) — ignore.
  }
  return out
}

/** Probe `mpv` on PATH by asking it for its version. Returns the name if OK. */
function probePath(): string | null {
  const exe = mpvExeName()
  try {
    execFileSync(exe, ['--version'], { stdio: 'ignore', timeout: 4000 })
    return exe
  } catch {
    return null
  }
}

let cached: string | null | undefined

/**
 * Resolve the mpv binary path/name, or null if mpv cannot be found.
 * Result is cached for the process lifetime.
 */
export function resolveMpvBinary(): string | null {
  if (cached !== undefined) return cached
  for (const candidate of bundledCandidates()) {
    if (existsSync(candidate)) {
      cached = candidate
      return cached
    }
  }
  cached = probePath()
  return cached
}

/** Reset the resolver cache (tests only). */
export function __resetMpvBinaryCache(): void {
  cached = undefined
}
