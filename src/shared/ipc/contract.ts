/**
 * The typed IPC contract. SOURCE OF TRUTH for request/response payloads.
 *
 * `IpcContract` maps each invoke channel to its { request, response } shape.
 * `EventContract` maps each event channel to its payload type.
 *
 * - Main process: implement a handler per channel typed by these shapes
 *   (see src/main/ipc/handlers.ts and the `IpcHandlers` helper type).
 * - Preload: exposes a typed `window.api` derived from this contract.
 *
 * Every invoke response is wrapped in Result<T> so failures are type-safe and
 * never thrown across the boundary.
 */

import type { Result } from '../types/common'
import type {
  AppInfo,
  AppSettings,
  ConnectionTestResult,
  CredentialsStatus,
  TmdbKeyStatus,
  UpdateCheckOutcome,
  XtreamCredentials
} from '../types/settings'
import type {
  ListStreamsRequest,
  RefreshCatalogRequest,
  RefreshCatalogResult,
  SearchRequest,
  VodCategory,
  VodInfo,
  VodStream
} from '../types/catalog'
import type {
  ListSeriesRequest,
  RefreshSeriesResult,
  SearchSeriesRequest,
  SeriesCategory,
  SeriesInfo,
  SeriesStream
} from '../types/series'
import type {
  EpgEntry,
  FullEpgRequest,
  ListLiveRequest,
  LiveCategory,
  LiveStream,
  RefreshLiveResult,
  SearchLiveRequest,
  ShortEpgRequest
} from '../types/live'
import type { AddFavoriteRequest, FavoriteItem, FavoriteKind, FavoriteRef } from '../types/favorites'
import type {
  AddReminderRequest,
  RecordingConflictEvent,
  RecordingConflictResolvedEvent,
  Reminder,
  ReminderOpenChannelEvent,
  ReminderUpdatedEvent,
  ResolveConflictRequest
} from '../types/reminders'
import type {
  AddDownloadRequest,
  DownloadItem,
  DownloadKind,
  DownloadProgressEvent,
  DownloadStateEvent,
  LocalPathResult,
  ReorderQueueRequest
} from '../types/downloads'
import type {
  FullscreenRequest,
  PlayerPositionEvent,
  PlayerStateEvent,
  PlayerStatus,
  PlayRequest,
  SeekRequest,
  StartRecordingRequest,
  SubtitleVisibleRequest,
  VolumeRequest
} from '../types/player'
import type { Page } from '../types/common'
import type { InvokeChannels, EventChannels } from './channels'

/**
 * Map of invoke channel -> { request; response }.
 * `response` is the *unwrapped* success type; the wire type is Result<response>.
 */
export interface IpcContract {
  // app
  [InvokeChannels.APP_INFO]: { request: void; response: AppInfo }
  [InvokeChannels.APP_CHECK_UPDATES]: { request: void; response: UpdateCheckOutcome }

  // connection / settings
  [InvokeChannels.CONNECTION_TEST]: { request: void; response: ConnectionTestResult }
  [InvokeChannels.CREDENTIALS_GET]: { request: void; response: CredentialsStatus }
  [InvokeChannels.CREDENTIALS_SET]: { request: XtreamCredentials; response: CredentialsStatus }
  [InvokeChannels.CREDENTIALS_CLEAR]: { request: void; response: CredentialsStatus }
  [InvokeChannels.SETTINGS_GET]: { request: void; response: AppSettings }
  [InvokeChannels.SETTINGS_SET]: { request: Partial<AppSettings>; response: AppSettings }
  [InvokeChannels.PICK_DOWNLOAD_DIR]: { request: void; response: { path: string | null } }

  // TMDB API key (encrypted; renderer only ever sees a status)
  [InvokeChannels.TMDB_GET_STATUS]: { request: void; response: TmdbKeyStatus }
  [InvokeChannels.TMDB_SET_KEY]: { request: { key: string }; response: TmdbKeyStatus }
  [InvokeChannels.TMDB_CLEAR_KEY]: { request: void; response: TmdbKeyStatus }

  // catalogue
  [InvokeChannels.CATALOG_LIST_CATEGORIES]: { request: void; response: VodCategory[] }
  [InvokeChannels.CATALOG_LIST_STREAMS]: { request: ListStreamsRequest; response: Page<VodStream> }
  [InvokeChannels.CATALOG_GET_INFO]: { request: { streamId: number }; response: VodInfo }
  [InvokeChannels.CATALOG_SEARCH]: { request: SearchRequest; response: Page<VodStream> }
  [InvokeChannels.CATALOG_REFRESH]: {
    request: RefreshCatalogRequest
    response: RefreshCatalogResult
  }

  // series
  [InvokeChannels.SERIES_LIST_CATEGORIES]: { request: void; response: SeriesCategory[] }
  [InvokeChannels.SERIES_LIST]: { request: ListSeriesRequest; response: Page<SeriesStream> }
  [InvokeChannels.SERIES_GET_INFO]: { request: { seriesId: number }; response: SeriesInfo }
  [InvokeChannels.SERIES_SEARCH]: { request: SearchSeriesRequest; response: Page<SeriesStream> }
  [InvokeChannels.SERIES_REFRESH]: { request: RefreshCatalogRequest; response: RefreshSeriesResult }

  // live
  [InvokeChannels.LIVE_LIST_CATEGORIES]: { request: void; response: LiveCategory[] }
  [InvokeChannels.LIVE_LIST]: { request: ListLiveRequest; response: Page<LiveStream> }
  [InvokeChannels.LIVE_SEARCH]: { request: SearchLiveRequest; response: Page<LiveStream> }
  [InvokeChannels.LIVE_REFRESH]: { request: RefreshCatalogRequest; response: RefreshLiveResult }
  [InvokeChannels.LIVE_EPG]: { request: ShortEpgRequest; response: EpgEntry[] }
  [InvokeChannels.LIVE_FULL_EPG]: { request: FullEpgRequest; response: EpgEntry[] }

  // favorites
  [InvokeChannels.FAVORITES_LIST]: { request: { kind: FavoriteKind }; response: FavoriteItem[] }
  [InvokeChannels.FAVORITES_ADD]: { request: AddFavoriteRequest; response: { ok: true } }
  [InvokeChannels.FAVORITES_REMOVE]: { request: FavoriteRef; response: { ok: true } }

  // reminders / scheduled recordings
  [InvokeChannels.REMINDERS_LIST]: { request: void; response: Reminder[] }
  [InvokeChannels.REMINDERS_ADD]: { request: AddReminderRequest; response: Reminder }
  [InvokeChannels.REMINDERS_CANCEL]: { request: { id: number }; response: Reminder }
  [InvokeChannels.RECORDING_RESOLVE_CONFLICT]: {
    request: ResolveConflictRequest
    response: { ok: true }
  }

  // downloads
  [InvokeChannels.DOWNLOAD_ADD]: { request: AddDownloadRequest; response: DownloadItem }
  [InvokeChannels.DOWNLOAD_LIST]: { request: void; response: DownloadItem[] }
  [InvokeChannels.DOWNLOAD_PAUSE]: { request: { id: number }; response: DownloadItem }
  [InvokeChannels.DOWNLOAD_RESUME]: { request: { id: number }; response: DownloadItem }
  [InvokeChannels.DOWNLOAD_CANCEL]: { request: { id: number }; response: DownloadItem }
  [InvokeChannels.DOWNLOAD_REORDER]: { request: ReorderQueueRequest; response: DownloadItem[] }
  [InvokeChannels.DOWNLOAD_CLEAR_COMPLETED]: { request: void; response: { removed: number } }
  [InvokeChannels.DOWNLOAD_LOCAL_PATH]: {
    request: { streamId: number; kind?: DownloadKind }
    response: LocalPathResult
  }
  [InvokeChannels.DOWNLOAD_COMPLETED_IDS]: { request: void; response: { ids: number[] } }

  // player
  [InvokeChannels.PLAYER_PLAY]: { request: PlayRequest; response: PlayerStatus }
  [InvokeChannels.PLAYER_PAUSE]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_RESUME]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_STOP]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_SEEK]: { request: SeekRequest; response: PlayerStatus }
  [InvokeChannels.PLAYER_VOLUME]: { request: VolumeRequest; response: PlayerStatus }
  [InvokeChannels.PLAYER_FULLSCREEN]: { request: FullscreenRequest; response: PlayerStatus }
  [InvokeChannels.PLAYER_STATUS]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_CYCLE_SUBTITLE]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_CYCLE_AUDIO]: { request: void; response: PlayerStatus }
  [InvokeChannels.PLAYER_SET_SUBTITLE_VISIBLE]: {
    request: SubtitleVisibleRequest
    response: PlayerStatus
  }
  [InvokeChannels.PLAYER_START_RECORDING]: {
    request: StartRecordingRequest
    response: PlayerStatus
  }
  [InvokeChannels.PLAYER_STOP_RECORDING]: { request: void; response: PlayerStatus }
}

/** Map of event channel -> payload pushed from main to renderer. */
export interface EventContract {
  [EventChannels.DOWNLOAD_PROGRESS]: DownloadProgressEvent
  [EventChannels.DOWNLOAD_STATE]: DownloadStateEvent
  [EventChannels.PLAYER_POSITION]: PlayerPositionEvent
  [EventChannels.PLAYER_STATE]: PlayerStateEvent
  [EventChannels.CONNECTION_BUSY]: { busy: boolean; reason: 'download' | 'playback' | null }
  [EventChannels.REMINDER_UPDATED]: ReminderUpdatedEvent
  [EventChannels.REMINDER_OPEN_CHANNEL]: ReminderOpenChannelEvent
  [EventChannels.RECORDING_CONFLICT]: RecordingConflictEvent
  [EventChannels.RECORDING_CONFLICT_RESOLVED]: RecordingConflictResolvedEvent
}

/** Convenience aliases. */
export type IpcRequest<C extends keyof IpcContract> = IpcContract[C]['request']
export type IpcResponse<C extends keyof IpcContract> = IpcContract[C]['response']
/** Wire type actually transmitted (Result-wrapped). */
export type IpcWireResponse<C extends keyof IpcContract> = Result<IpcResponse<C>>
export type EventPayload<C extends keyof EventContract> = EventContract[C]

/**
 * Helper type for the main process: the shape of the handler object that must
 * implement every channel. A handler receives the (validated) request and
 * returns a Result of the response (or a Promise thereof).
 */
export type IpcHandlers = {
  [C in keyof IpcContract]: (
    request: IpcRequest<C>
  ) => IpcWireResponse<C> | Promise<IpcWireResponse<C>>
}
