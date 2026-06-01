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
  AppSettings,
  ConnectionTestResult,
  CredentialsStatus,
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
  AddDownloadRequest,
  DownloadItem,
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
  // connection / settings
  [InvokeChannels.CONNECTION_TEST]: { request: void; response: ConnectionTestResult }
  [InvokeChannels.CREDENTIALS_GET]: { request: void; response: CredentialsStatus }
  [InvokeChannels.CREDENTIALS_SET]: { request: XtreamCredentials; response: CredentialsStatus }
  [InvokeChannels.CREDENTIALS_CLEAR]: { request: void; response: CredentialsStatus }
  [InvokeChannels.SETTINGS_GET]: { request: void; response: AppSettings }
  [InvokeChannels.SETTINGS_SET]: { request: Partial<AppSettings>; response: AppSettings }
  [InvokeChannels.PICK_DOWNLOAD_DIR]: { request: void; response: { path: string | null } }

  // catalogue
  [InvokeChannels.CATALOG_LIST_CATEGORIES]: { request: void; response: VodCategory[] }
  [InvokeChannels.CATALOG_LIST_STREAMS]: { request: ListStreamsRequest; response: Page<VodStream> }
  [InvokeChannels.CATALOG_GET_INFO]: { request: { streamId: number }; response: VodInfo }
  [InvokeChannels.CATALOG_SEARCH]: { request: SearchRequest; response: Page<VodStream> }
  [InvokeChannels.CATALOG_REFRESH]: {
    request: RefreshCatalogRequest
    response: RefreshCatalogResult
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
    request: { streamId: number }
    response: LocalPathResult
  }

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
}

/** Map of event channel -> payload pushed from main to renderer. */
export interface EventContract {
  [EventChannels.DOWNLOAD_PROGRESS]: DownloadProgressEvent
  [EventChannels.DOWNLOAD_STATE]: DownloadStateEvent
  [EventChannels.PLAYER_POSITION]: PlayerPositionEvent
  [EventChannels.PLAYER_STATE]: PlayerStateEvent
  [EventChannels.CONNECTION_BUSY]: { busy: boolean; reason: 'download' | 'playback' | null }
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
