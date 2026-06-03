/**
 * Central registry of every IPC channel name. SOURCE OF TRUTH.
 *
 * Two kinds of channels:
 *  - "invoke" channels: request/response via ipcRenderer.invoke / ipcMain.handle.
 *  - "event"  channels: one-way main -> renderer streams via webContents.send.
 *
 * Channel names are namespaced "domain:verb" to avoid collisions.
 * Keep this file framework-free (no electron import) so it is usable everywhere.
 */

/** Request/response channels (renderer -> main, awaitable). */
export const InvokeChannels = {
  // --- app ---
  APP_INFO: 'app:info', // app metadata (version) for the renderer
  APP_CHECK_UPDATES: 'app:checkUpdates', // manual "check for updates" trigger

  // --- connection / settings ---
  CONNECTION_TEST: 'connection:test',
  CREDENTIALS_GET: 'credentials:get', // returns status only, never the password
  CREDENTIALS_SET: 'credentials:set',
  CREDENTIALS_CLEAR: 'credentials:clear',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PICK_DOWNLOAD_DIR: 'settings:pickDownloadDir',

  // --- TMDB API key (encrypted secret) ---
  TMDB_GET_STATUS: 'tmdb:getStatus',
  TMDB_SET_KEY: 'tmdb:setKey',
  TMDB_CLEAR_KEY: 'tmdb:clearKey',

  // --- catalogue ---
  CATALOG_LIST_CATEGORIES: 'catalog:listCategories',
  CATALOG_LIST_STREAMS: 'catalog:listStreams',
  CATALOG_GET_INFO: 'catalog:getInfo',
  CATALOG_SEARCH: 'catalog:search',
  CATALOG_REFRESH: 'catalog:refresh',

  // --- series ---
  SERIES_LIST_CATEGORIES: 'series:listCategories',
  SERIES_LIST: 'series:list',
  SERIES_GET_INFO: 'series:getInfo',
  SERIES_SEARCH: 'series:search',
  SERIES_REFRESH: 'series:refresh',

  // --- live ---
  LIVE_LIST_CATEGORIES: 'live:listCategories',
  LIVE_LIST: 'live:list',
  LIVE_SEARCH: 'live:search',
  LIVE_REFRESH: 'live:refresh',
  LIVE_EPG: 'live:epg',

  // --- favorites ---
  FAVORITES_LIST: 'favorites:list',
  FAVORITES_ADD: 'favorites:add',
  FAVORITES_REMOVE: 'favorites:remove',

  // --- downloads ---
  DOWNLOAD_ADD: 'download:add',
  DOWNLOAD_LIST: 'download:list',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_REORDER: 'download:reorder',
  DOWNLOAD_CLEAR_COMPLETED: 'download:clearCompleted',
  DOWNLOAD_LOCAL_PATH: 'download:localPath',
  DOWNLOAD_COMPLETED_IDS: 'download:completedIds', // persistent "already downloaded" set

  // --- player ---
  PLAYER_PLAY: 'player:play',
  PLAYER_PAUSE: 'player:pause',
  PLAYER_RESUME: 'player:resume',
  PLAYER_STOP: 'player:stop',
  PLAYER_SEEK: 'player:seek',
  PLAYER_VOLUME: 'player:volume',
  PLAYER_FULLSCREEN: 'player:fullscreen',
  PLAYER_STATUS: 'player:status',
  PLAYER_CYCLE_SUBTITLE: 'player:cycleSubtitle',
  PLAYER_CYCLE_AUDIO: 'player:cycleAudio',
  PLAYER_SET_SUBTITLE_VISIBLE: 'player:setSubtitleVisible',
  PLAYER_START_RECORDING: 'player:startRecording', // dump the playing stream to disk (live)
  PLAYER_STOP_RECORDING: 'player:stopRecording'
} as const

/** One-way event channels (main -> renderer). */
export const EventChannels = {
  DOWNLOAD_PROGRESS: 'event:download:progress',
  DOWNLOAD_STATE: 'event:download:state',
  PLAYER_POSITION: 'event:player:position',
  PLAYER_STATE: 'event:player:state',
  /** Connection lock state changed (e.g. download paused for playback). */
  CONNECTION_BUSY: 'event:connection:busy'
} as const

export type InvokeChannel = (typeof InvokeChannels)[keyof typeof InvokeChannels]
export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels]

/** All event channel names as an array (used by preload allowlist). */
export const ALL_EVENT_CHANNELS: readonly EventChannel[] = Object.values(EventChannels)
