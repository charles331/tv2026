/**
 * IPC handlers — STUB implementations.
 *
 * These satisfy the typed IpcContract so the app compiles and runs end-to-end.
 * Real logic is filled in by the domain agents:
 *   - connection/settings: electron-architect (settings + credentials done here;
 *     connection:test is a stub until xtream-api-specialist wires the client)
 *   - catalogue:           xtream-api-specialist  (reads via catalogRepo)
 *   - downloads:           download-engineer       (drives downloadsRepo + lock)
 *   - player:              mpv-player-integrator    (drives mpv + lock)
 *
 * Each handler returns a Result<T>; never throws across the boundary.
 * registerIpcHandlers() applies validation + Result wrapping uniformly.
 */

import { join as pathJoin } from 'path'
import { app, dialog } from 'electron'
import type { IpcHandlers } from '@shared/index'
import { InvokeChannels, ok, err } from '@shared/index'
import type {
  AppSettings,
  ConnectionTestResult,
  PlayRequest,
  PlaySourceKind,
  XtreamCredentials
} from '@shared/index'
import { existsSync } from 'fs'
import { settingsRepo, catalogRepo, seriesRepo, liveRepo, favoritesRepo, downloadsRepo } from '../store'
import { downloadManager } from '../downloads/DownloadManager'
import { downloadSubfolder } from '../downloads/helpers'
import { playerController } from '../player/PlayerController'
import * as credentials from '../secrets/credentials'
import * as tmdbKey from '../secrets/tmdbKey'
import { getXtreamClient, XtreamError, toErrorCode } from '../xtream'
import { refreshCatalog, getVodInfo } from '../xtream/catalogService'
import { refreshSeries, getSeriesInfo } from '../xtream/seriesService'
import { refreshLive, getShortEpg } from '../xtream/liveService'
import { checkForUpdatesNow } from '../updater'
import {
  assert,
  assertPathWithin,
  isObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireBaseUrl,
  requireInt,
  requireNumber,
  requireString
} from './validate'

/**
 * Convert a thrown XtreamError into the shared Result error envelope. Anything
 * that is not an XtreamError is re-thrown so register.ts maps it to UNKNOWN.
 * Credentials never appear in these messages (the client masks them).
 */
function fromXtreamError(e: unknown): ReturnType<typeof err> {
  if (e instanceof XtreamError) {
    return err(toErrorCode(e.kind), e.message, e.details)
  }
  throw e
}

/**
 * Sanitize a filename for the Windows filesystem: strip reserved characters
 * (\ / : * ? " < > |) plus control chars, collapse whitespace, and trim.
 */
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned || 'download'
}

/**
 * Join a download directory and filename. The directory is a Windows path at
 * runtime; path.join handles the separators for the host platform.
 */
function joinPath(dir: string, fileName: string): string {
  return pathJoin(dir, fileName)
}

/** Filesystem-safe local timestamp for recording filenames: "2026-06-03 14-30-05". */
function recordingTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  )
}

/**
 * The complete handler map. Implemented domains return real data; not-yet-built
 * domains return a NOT_IMPLEMENTED Result so the renderer can show a clear state.
 */
export const handlers: IpcHandlers = {
  // ---------------- app (real) ----------------
  [InvokeChannels.APP_INFO]: () => ok({ version: app.getVersion() }),

  [InvokeChannels.APP_CHECK_UPDATES]: async () => ok(await checkForUpdatesNow()),

  // ---------------- connection / settings (real) ----------------
  [InvokeChannels.CONNECTION_TEST]: async () => {
    try {
      const client = getXtreamClient()
      try {
        const account = await client.getAccountInfo()
        const result: ConnectionTestResult = {
          status: account.status,
          expiresAt: account.expiresAt,
          maxConnections: account.maxConnections,
          activeConnections: account.activeConnections,
          isTrial: account.isTrial
        }
        return ok(result)
      } finally {
        await client.close()
      }
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  [InvokeChannels.CREDENTIALS_GET]: () => ok(credentials.getCredentialsStatus()),

  [InvokeChannels.CREDENTIALS_SET]: (req) => {
    assert(isObject(req), 'request must be an object')
    const creds: XtreamCredentials = {
      baseUrl: requireBaseUrl(req, 'baseUrl'),
      username: requireString(req, 'username', 256),
      password: requireString(req, 'password', 256)
    }
    if (!credentials.isEncryptionAvailable()) {
      return err('UNKNOWN', 'OS encryption (safeStorage) is unavailable; cannot store credentials securely.')
    }
    credentials.setCredentials(creds)
    return ok(credentials.getCredentialsStatus())
  },

  [InvokeChannels.CREDENTIALS_CLEAR]: () => {
    credentials.clearCredentials()
    return ok(credentials.getCredentialsStatus())
  },

  [InvokeChannels.SETTINGS_GET]: () => ok(settingsRepo.getSettings()),

  [InvokeChannels.SETTINGS_SET]: (req) => {
    assert(isObject(req), 'request must be an object')
    // Whitelist patchable keys; ignore unknown / constraint-locked fields.
    const patch: Partial<AppSettings> = {}
    if ('downloadDir' in req) patch.downloadDir = optionalString(req, 'downloadDir') ?? null
    if ('filenameTemplate' in req)
      patch.filenameTemplate = requireString(req, 'filenameTemplate', 256)
    if ('theme' in req) {
      const t = requireString(req, 'theme', 16)
      assert(['dark', 'light', 'system'].includes(t), 'invalid theme')
      patch.theme = t as AppSettings['theme']
    }
    if ('diskSpaceWarningBytes' in req)
      patch.diskSpaceWarningBytes = requireInt(req, 'diskSpaceWarningBytes')
    if ('lastSeenVersion' in req)
      patch.lastSeenVersion = optionalString(req, 'lastSeenVersion', 32) ?? null
    return ok(settingsRepo.setSettings(patch))
  },

  [InvokeChannels.PICK_DOWNLOAD_DIR]: async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return ok({ path: null })
    return ok({ path: res.filePaths[0]! })
  },

  // ---------------- TMDB API key (encrypted secret) ----------------
  [InvokeChannels.TMDB_GET_STATUS]: () => ok(tmdbKey.getTmdbKeyStatus()),

  [InvokeChannels.TMDB_SET_KEY]: (req) => {
    assert(isObject(req), 'request must be an object')
    const key = requireString(req, 'key', 128)
    if (key.trim() && !tmdbKey.isEncryptionAvailable()) {
      return err('UNKNOWN', 'OS encryption (safeStorage) is unavailable; cannot store the key securely.')
    }
    tmdbKey.setTmdbKey(key)
    return ok(tmdbKey.getTmdbKeyStatus())
  },

  [InvokeChannels.TMDB_CLEAR_KEY]: () => {
    tmdbKey.clearTmdbKey()
    return ok(tmdbKey.getTmdbKeyStatus())
  },

  // ---------------- catalogue (real: cache reads + provider refresh/getInfo) ----------------
  [InvokeChannels.CATALOG_LIST_CATEGORIES]: () => ok(catalogRepo.listCategories()),

  [InvokeChannels.CATALOG_LIST_STREAMS]: (req) => {
    assert(isObject(req), 'request must be an object')
    const page = requireInt(req, 'page')
    const pageSize = requireInt(req, 'pageSize')
    const categoryId = optionalString(req, 'categoryId') ?? null
    return ok(
      catalogRepo.listStreams({
        page,
        pageSize,
        categoryId,
        sortBy: (optionalString(req, 'sortBy') as never) ?? 'name',
        sortDir: (optionalString(req, 'sortDir') as never) ?? 'asc'
      })
    )
  },

  [InvokeChannels.CATALOG_GET_INFO]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const streamId = requireInt(req, 'streamId')
    try {
      // Serves from vod_info_cache when fresh; otherwise fetches + caches.
      return ok(await getVodInfo(streamId))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  [InvokeChannels.CATALOG_SEARCH]: (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      catalogRepo.searchStreams({
        query: requireString(req, 'query', 256),
        categoryId: optionalString(req, 'categoryId') ?? null,
        page: requireInt(req, 'page'),
        pageSize: requireInt(req, 'pageSize')
      })
    )
  },

  [InvokeChannels.CATALOG_REFRESH]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const force = Boolean((req as { force?: unknown }).force)
    try {
      return ok(await refreshCatalog(force))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  // ---------------- series (cache reads + provider refresh/getInfo) ----------------
  [InvokeChannels.SERIES_LIST_CATEGORIES]: () => ok(seriesRepo.listCategories()),

  [InvokeChannels.SERIES_LIST]: (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      seriesRepo.listSeries({
        page: requireInt(req, 'page'),
        pageSize: requireInt(req, 'pageSize'),
        categoryId: optionalString(req, 'categoryId') ?? null,
        sortBy: (optionalString(req, 'sortBy') as never) ?? 'name',
        sortDir: (optionalString(req, 'sortDir') as never) ?? 'asc'
      })
    )
  },

  [InvokeChannels.SERIES_GET_INFO]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const seriesId = requireInt(req, 'seriesId')
    try {
      return ok(await getSeriesInfo(seriesId))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  [InvokeChannels.SERIES_SEARCH]: (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      seriesRepo.searchSeries({
        query: requireString(req, 'query', 256),
        categoryId: optionalString(req, 'categoryId') ?? null,
        page: requireInt(req, 'page'),
        pageSize: requireInt(req, 'pageSize')
      })
    )
  },

  [InvokeChannels.SERIES_REFRESH]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const force = Boolean((req as { force?: unknown }).force)
    try {
      return ok(await refreshSeries(force))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  // ---------------- live (cache reads + provider refresh + on-demand EPG) ----------------
  [InvokeChannels.LIVE_LIST_CATEGORIES]: () => ok(liveRepo.listCategories()),

  [InvokeChannels.LIVE_LIST]: (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      liveRepo.listChannels({
        page: requireInt(req, 'page'),
        pageSize: requireInt(req, 'pageSize'),
        categoryId: optionalString(req, 'categoryId') ?? null,
        sortBy: (optionalString(req, 'sortBy') as never) ?? 'number',
        sortDir: (optionalString(req, 'sortDir') as never) ?? 'asc'
      })
    )
  },

  [InvokeChannels.LIVE_SEARCH]: (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      liveRepo.searchChannels({
        query: requireString(req, 'query', 256),
        categoryId: optionalString(req, 'categoryId') ?? null,
        page: requireInt(req, 'page'),
        pageSize: requireInt(req, 'pageSize')
      })
    )
  },

  [InvokeChannels.LIVE_REFRESH]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const force = Boolean((req as { force?: unknown }).force)
    try {
      return ok(await refreshLive(force))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  [InvokeChannels.LIVE_EPG]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const streamId = requireInt(req, 'streamId')
    const limit = optionalNumber(req, 'limit')
    try {
      return ok(await getShortEpg(streamId, limit && limit > 0 ? Math.trunc(limit) : 2))
    } catch (e) {
      return fromXtreamError(e)
    }
  },

  // ---------------- favorites (local, SQLite) ----------------
  [InvokeChannels.FAVORITES_LIST]: (req) => {
    assert(isObject(req), 'request must be an object')
    const kind = requireString(req, 'kind', 16)
    assert(kind === 'movie' || kind === 'series' || kind === 'live', 'invalid kind')
    return ok(favoritesRepo.listFavorites(kind))
  },

  [InvokeChannels.FAVORITES_ADD]: (req) => {
    assert(isObject(req), 'request must be an object')
    const kind = requireString(req, 'kind', 16)
    assert(kind === 'movie' || kind === 'series' || kind === 'live', 'invalid kind')
    favoritesRepo.addFavorite({
      kind,
      itemId: requireInt(req, 'itemId'),
      name: requireString(req, 'name', 512),
      image: optionalString(req, 'image', 2048) ?? null,
      containerExtension: optionalString(req, 'containerExtension', 16) ?? null,
      categoryId: optionalString(req, 'categoryId', 128) ?? null
    })
    return ok({ ok: true as const })
  },

  [InvokeChannels.FAVORITES_REMOVE]: (req) => {
    assert(isObject(req), 'request must be an object')
    const kind = requireString(req, 'kind', 16)
    assert(kind === 'movie' || kind === 'series' || kind === 'live', 'invalid kind')
    favoritesRepo.removeFavorite(kind, requireInt(req, 'itemId'))
    return ok({ ok: true as const })
  },

  // ---------------- downloads (real engine via DownloadManager) ----------------
  [InvokeChannels.DOWNLOAD_ADD]: (req) => {
    assert(isObject(req), 'request must be an object')
    const settings = settingsRepo.getSettings()
    if (!settings.downloadDir) {
      return err('INVALID_INPUT', 'No download directory configured. Set one in settings first.')
    }
    if (!credentials.getCredentialsStatus().hasCredentials) {
      return err('NOT_CONNECTED', 'No IPTV credentials configured. Add them in settings first.')
    }
    const streamId = requireInt(req, 'streamId')
    const name = requireString(req, 'name', 512)
    const ext = requireString(req, 'containerExtension', 16)
    const kind: 'movie' | 'series' = optionalString(req, 'kind') === 'series' ? 'series' : 'movie'
    const cleanExt = ext.replace(/^\.+/, '').trim() || 'mkv'
    const fileName = optionalString(req, 'fileName') ?? `${name}.${cleanExt}`
    const safeName = sanitizeFileName(fileName)
    // Organize the library into per-kind subfolders (Films / Séries). The
    // DownloadManager mkdir's the destination directory recursively before the
    // transfer, so the subfolder is created on demand.
    const destDir = joinPath(settings.downloadDir, downloadSubfolder(kind))
    const item = downloadManager.add({
      streamId,
      kind,
      name,
      containerExtension: cleanExt,
      fileName: safeName,
      destPath: joinPath(destDir, safeName)
    })
    return ok(item)
  },

  [InvokeChannels.DOWNLOAD_LIST]: () => ok(downloadManager.list()),

  [InvokeChannels.DOWNLOAD_PAUSE]: (req) => {
    assert(isObject(req), 'request must be an object')
    const id = requireInt(req, 'id')
    const item = downloadManager.pause(id)
    if (!item) return err('NOT_FOUND', `Download ${id} not found`)
    return ok(item)
  },

  [InvokeChannels.DOWNLOAD_RESUME]: (req) => {
    assert(isObject(req), 'request must be an object')
    const id = requireInt(req, 'id')
    const item = downloadManager.resume(id)
    if (!item) return err('NOT_FOUND', `Download ${id} not found`)
    return ok(item)
  },

  [InvokeChannels.DOWNLOAD_CANCEL]: (req) => {
    assert(isObject(req), 'request must be an object')
    const id = requireInt(req, 'id')
    const item = downloadManager.cancel(id)
    if (!item) return err('NOT_FOUND', `Download ${id} not found`)
    return ok(item)
  },

  [InvokeChannels.DOWNLOAD_REORDER]: (req) => {
    assert(isObject(req), 'request must be an object')
    const ids = (req as { orderedIds?: unknown }).orderedIds
    assert(Array.isArray(ids) && ids.every((n) => Number.isInteger(n)), 'orderedIds must be int[]')
    return ok(downloadManager.reorder(ids as number[]))
  },

  [InvokeChannels.DOWNLOAD_CLEAR_COMPLETED]: () =>
    ok({ removed: downloadManager.clearCompleted() }),

  [InvokeChannels.DOWNLOAD_LOCAL_PATH]: (req) => {
    assert(isObject(req), 'request must be an object')
    const streamId = requireInt(req, 'streamId')
    const kind: 'movie' | 'series' = optionalString(req, 'kind') === 'series' ? 'series' : 'movie'
    const recorded = downloadsRepo.getCompletedPath(streamId, kind)
    // Only report a path if a completed download is recorded AND the file is
    // still present on disk; otherwise the caller falls back to streaming.
    if (recorded && existsSync(recorded)) return ok({ path: recorded })
    return ok({ path: null })
  },

  [InvokeChannels.DOWNLOAD_COMPLETED_IDS]: () =>
    ok({ ids: downloadsRepo.listCompletedStreamIds() }),

  // ---------------- player (real: drives mpv via PlayerController) ----------------
  [InvokeChannels.PLAYER_PLAY]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const kind = requireString(req, 'kind', 16)
    assert(kind === 'local' || kind === 'stream', 'kind must be "local" or "stream"')
    const playReq: PlayRequest = {
      kind: kind as PlaySourceKind,
      mediaKind: ((): 'movie' | 'series' | 'live' => {
        const m = optionalString(req, 'mediaKind')
        return m === 'series' || m === 'live' ? m : 'movie'
      })(),
      filePath: optionalString(req, 'filePath'),
      streamId: optionalNumber(req, 'streamId'),
      containerExtension: optionalString(req, 'containerExtension', 16),
      title: optionalString(req, 'title', 512),
      startSecs: optionalNumber(req, 'startSecs')
    }
    if (kind === 'local') {
      assert(playReq.filePath !== undefined, 'filePath is required for local playback')
      // Security: the renderer may only play files inside the configured download
      // directory. Reject anything that is non-absolute or escapes that dir, so a
      // compromised renderer cannot ask mpv to open arbitrary local files.
      const downloadDir = settingsRepo.getSettings().downloadDir
      if (!downloadDir) {
        return err('INVALID_INPUT', 'No download directory configured; cannot play a local file.')
      }
      // assertPathWithin throws ValidationError -> mapped to INVALID_INPUT.
      playReq.filePath = assertPathWithin(playReq.filePath, downloadDir)
    } else {
      assert(playReq.streamId !== undefined, 'streamId is required for stream playback')
      if (!credentials.getCredentialsStatus().hasCredentials) {
        return err('NOT_CONNECTED', 'No IPTV credentials configured. Add them in settings first.')
      }
    }
    return ok(await playerController.play(playReq))
  },

  [InvokeChannels.PLAYER_PAUSE]: async () => ok(await playerController.pause()),
  [InvokeChannels.PLAYER_RESUME]: async () => ok(await playerController.resume()),
  [InvokeChannels.PLAYER_STOP]: async () => ok(await playerController.stop()),

  [InvokeChannels.PLAYER_SEEK]: async (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(await playerController.seek({ positionSecs: requireNumber(req, 'positionSecs') }))
  },

  [InvokeChannels.PLAYER_VOLUME]: async (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(
      await playerController.setVolume({
        volume: requireNumber(req, 'volume'),
        muted: optionalBoolean(req, 'muted')
      })
    )
  },

  [InvokeChannels.PLAYER_FULLSCREEN]: async (req) => {
    assert(isObject(req), 'request must be an object')
    return ok(await playerController.setFullscreen({ fullscreen: optionalBoolean(req, 'fullscreen') ?? false }))
  },

  [InvokeChannels.PLAYER_STATUS]: () => ok(playerController.getStatus()),

  [InvokeChannels.PLAYER_CYCLE_SUBTITLE]: async () => ok(await playerController.cycleSubtitle()),
  [InvokeChannels.PLAYER_CYCLE_AUDIO]: async () => ok(await playerController.cycleAudio()),

  [InvokeChannels.PLAYER_SET_SUBTITLE_VISIBLE]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const visible = optionalBoolean(req, 'visible')
    assert(visible !== undefined, 'visible is required')
    return ok(await playerController.setSubtitleVisible(visible))
  },

  [InvokeChannels.PLAYER_START_RECORDING]: async (req) => {
    assert(isObject(req), 'request must be an object')
    const settings = settingsRepo.getSettings()
    if (!settings.downloadDir) {
      return err('INVALID_INPUT', 'Aucun dossier de téléchargement configuré pour l’enregistrement.')
    }
    if (!playerController.canRecord()) {
      return err('INVALID_INPUT', 'Aucune lecture en direct en cours à enregistrer.')
    }
    // Build a sanitized, timestamped .ts filename inside the Live subfolder, then
    // confirm it stays within the download directory (defense in depth).
    const base = sanitizeFileName(optionalString(req, 'name', 512) ?? 'Enregistrement')
    const liveDir = joinPath(settings.downloadDir, downloadSubfolder('live'))
    const filePath = assertPathWithin(
      joinPath(liveDir, `${base} ${recordingTimestamp()}.ts`),
      settings.downloadDir
    )
    return ok(await playerController.startRecording(filePath))
  },

  [InvokeChannels.PLAYER_STOP_RECORDING]: async () => ok(await playerController.stopRecording())
}
