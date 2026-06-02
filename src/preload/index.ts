/**
 * Preload — the ONLY bridge between renderer and main.
 *
 * Exposes a typed `window.api` (RendererApi) via contextBridge. The renderer has
 * no Node integration; everything goes through these whitelisted methods which
 * forward to ipcRenderer.invoke / subscribe to a fixed set of event channels.
 *
 * Event subscriptions are guarded: only channels in ALL_EVENT_CHANNELS are
 * allowed, and listeners receive only the payload (never the raw IpcEvent).
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  RendererApi,
  Unsubscribe,
  IpcResponse,
  Result,
  EventChannel,
  EventPayload
} from '@shared/index'
import { InvokeChannels, EventChannels, ALL_EVENT_CHANNELS } from '@shared/index'

/** Untyped invoke wrapper; call sites cast to the contract response type. */
function invoke(channel: string, request?: unknown): Promise<unknown> {
  return ipcRenderer.invoke(channel, request)
}

/** Typed event subscription with channel allowlist + auto-cleanup. */
function subscribe<C extends EventChannel>(
  channel: C,
  cb: (payload: EventPayload<C>) => void
): Unsubscribe {
  if (!ALL_EVENT_CHANNELS.includes(channel)) {
    throw new Error(`Refusing to subscribe to non-whitelisted channel: ${channel}`)
  }
  const listener = (_event: unknown, payload: EventPayload<C>): void => cb(payload)
  ipcRenderer.on(channel, listener as never)
  return () => ipcRenderer.removeListener(channel, listener as never)
}

const api: RendererApi = {
  app: {
    info: () =>
      invoke(InvokeChannels.APP_INFO) as Promise<
        Result<IpcResponse<typeof InvokeChannels.APP_INFO>>
      >
  },

  connection: {
    test: () => invoke(InvokeChannels.CONNECTION_TEST) as Promise<Result<IpcResponse<typeof InvokeChannels.CONNECTION_TEST>>>,
    getCredentials: () =>
      invoke(InvokeChannels.CREDENTIALS_GET) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CREDENTIALS_GET>>
      >,
    setCredentials: (creds) =>
      invoke(InvokeChannels.CREDENTIALS_SET, creds) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CREDENTIALS_SET>>
      >,
    clearCredentials: () =>
      invoke(InvokeChannels.CREDENTIALS_CLEAR) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CREDENTIALS_CLEAR>>
      >
  },

  settings: {
    get: () =>
      invoke(InvokeChannels.SETTINGS_GET) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SETTINGS_GET>>
      >,
    set: (patch) =>
      invoke(InvokeChannels.SETTINGS_SET, patch) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SETTINGS_SET>>
      >,
    pickDownloadDir: () =>
      invoke(InvokeChannels.PICK_DOWNLOAD_DIR) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PICK_DOWNLOAD_DIR>>
      >
  },

  tmdb: {
    getStatus: () =>
      invoke(InvokeChannels.TMDB_GET_STATUS) as Promise<
        Result<IpcResponse<typeof InvokeChannels.TMDB_GET_STATUS>>
      >,
    setKey: (key) =>
      invoke(InvokeChannels.TMDB_SET_KEY, { key }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.TMDB_SET_KEY>>
      >,
    clearKey: () =>
      invoke(InvokeChannels.TMDB_CLEAR_KEY) as Promise<
        Result<IpcResponse<typeof InvokeChannels.TMDB_CLEAR_KEY>>
      >
  },

  catalog: {
    listCategories: () =>
      invoke(InvokeChannels.CATALOG_LIST_CATEGORIES) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CATALOG_LIST_CATEGORIES>>
      >,
    listStreams: (req) =>
      invoke(InvokeChannels.CATALOG_LIST_STREAMS, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CATALOG_LIST_STREAMS>>
      >,
    getInfo: (streamId) =>
      invoke(InvokeChannels.CATALOG_GET_INFO, { streamId }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CATALOG_GET_INFO>>
      >,
    search: (req) =>
      invoke(InvokeChannels.CATALOG_SEARCH, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CATALOG_SEARCH>>
      >,
    refresh: (req) =>
      invoke(InvokeChannels.CATALOG_REFRESH, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.CATALOG_REFRESH>>
      >
  },

  series: {
    listCategories: () =>
      invoke(InvokeChannels.SERIES_LIST_CATEGORIES) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SERIES_LIST_CATEGORIES>>
      >,
    list: (req) =>
      invoke(InvokeChannels.SERIES_LIST, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SERIES_LIST>>
      >,
    getInfo: (seriesId) =>
      invoke(InvokeChannels.SERIES_GET_INFO, { seriesId }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SERIES_GET_INFO>>
      >,
    search: (req) =>
      invoke(InvokeChannels.SERIES_SEARCH, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SERIES_SEARCH>>
      >,
    refresh: (req) =>
      invoke(InvokeChannels.SERIES_REFRESH, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.SERIES_REFRESH>>
      >
  },

  downloads: {
    add: (req) =>
      invoke(InvokeChannels.DOWNLOAD_ADD, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_ADD>>
      >,
    list: () =>
      invoke(InvokeChannels.DOWNLOAD_LIST) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_LIST>>
      >,
    pause: (id) =>
      invoke(InvokeChannels.DOWNLOAD_PAUSE, { id }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_PAUSE>>
      >,
    resume: (id) =>
      invoke(InvokeChannels.DOWNLOAD_RESUME, { id }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_RESUME>>
      >,
    cancel: (id) =>
      invoke(InvokeChannels.DOWNLOAD_CANCEL, { id }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_CANCEL>>
      >,
    reorder: (req) =>
      invoke(InvokeChannels.DOWNLOAD_REORDER, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_REORDER>>
      >,
    clearCompleted: () =>
      invoke(InvokeChannels.DOWNLOAD_CLEAR_COMPLETED) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_CLEAR_COMPLETED>>
      >,
    localPath: (streamId, kind) =>
      invoke(InvokeChannels.DOWNLOAD_LOCAL_PATH, { streamId, kind }) as Promise<
        Result<IpcResponse<typeof InvokeChannels.DOWNLOAD_LOCAL_PATH>>
      >,
    onProgress: (cb) => subscribe(EventChannels.DOWNLOAD_PROGRESS, cb),
    onState: (cb) => subscribe(EventChannels.DOWNLOAD_STATE, cb)
  },

  player: {
    play: (req) =>
      invoke(InvokeChannels.PLAYER_PLAY, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_PLAY>>
      >,
    pause: () =>
      invoke(InvokeChannels.PLAYER_PAUSE) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_PAUSE>>
      >,
    resume: () =>
      invoke(InvokeChannels.PLAYER_RESUME) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_RESUME>>
      >,
    stop: () =>
      invoke(InvokeChannels.PLAYER_STOP) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_STOP>>
      >,
    seek: (req) =>
      invoke(InvokeChannels.PLAYER_SEEK, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_SEEK>>
      >,
    setVolume: (req) =>
      invoke(InvokeChannels.PLAYER_VOLUME, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_VOLUME>>
      >,
    setFullscreen: (req) =>
      invoke(InvokeChannels.PLAYER_FULLSCREEN, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_FULLSCREEN>>
      >,
    status: () =>
      invoke(InvokeChannels.PLAYER_STATUS) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_STATUS>>
      >,
    cycleSubtitle: () =>
      invoke(InvokeChannels.PLAYER_CYCLE_SUBTITLE) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_CYCLE_SUBTITLE>>
      >,
    cycleAudio: () =>
      invoke(InvokeChannels.PLAYER_CYCLE_AUDIO) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_CYCLE_AUDIO>>
      >,
    setSubtitleVisible: (req) =>
      invoke(InvokeChannels.PLAYER_SET_SUBTITLE_VISIBLE, req) as Promise<
        Result<IpcResponse<typeof InvokeChannels.PLAYER_SET_SUBTITLE_VISIBLE>>
      >,
    onPosition: (cb) => subscribe(EventChannels.PLAYER_POSITION, cb),
    onState: (cb) => subscribe(EventChannels.PLAYER_STATE, cb)
  },

  connectionLock: {
    onBusyChange: (cb) => subscribe(EventChannels.CONNECTION_BUSY, cb)
  }
}

// Expose under contextIsolation. If isolation is somehow off, fail loudly
// rather than leaking onto window unguarded.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] exposeInMainWorld failed', error)
  }
} else {
  throw new Error('contextIsolation must be enabled')
}
