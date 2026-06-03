/**
 * The typed API surface exposed on the renderer's `window.api` via contextBridge.
 * SOURCE OF TRUTH for what the renderer can call.
 *
 * The shape here is hand-written (rather than fully generated) so the renderer
 * gets ergonomic, discoverable method names with full type inference. The
 * preload implements exactly this interface by forwarding to ipcRenderer.invoke
 * over the channels in channels.ts.
 */

import type { Result } from '../types/common'
import type { Page } from '../types/common'
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
  ListLiveRequest,
  LiveCategory,
  LiveStream,
  RefreshLiveResult,
  SearchLiveRequest
} from '../types/live'
import type { AddFavoriteRequest, FavoriteItem, FavoriteKind } from '../types/favorites'
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
  SubtitleVisibleRequest,
  VolumeRequest
} from '../types/player'

/** Unsubscribe function returned by event subscriptions. */
export type Unsubscribe = () => void

export interface AppApi {
  /** App metadata (version) for the renderer. */
  info(): Promise<Result<AppInfo>>
  /** Manually check for an app update (downloads + installs on quit if newer). */
  checkForUpdates(): Promise<Result<UpdateCheckOutcome>>
}

export interface ConnectionApi {
  test(): Promise<Result<ConnectionTestResult>>
  /** Stored-credentials status (booleans + baseUrl/username) — never the password. */
  getCredentialsStatus(): Promise<Result<CredentialsStatus>>
  setCredentials(creds: XtreamCredentials): Promise<Result<CredentialsStatus>>
  clearCredentials(): Promise<Result<CredentialsStatus>>
}

export interface SettingsApi {
  get(): Promise<Result<AppSettings>>
  set(patch: Partial<AppSettings>): Promise<Result<AppSettings>>
  pickDownloadDir(): Promise<Result<{ path: string | null }>>
}

export interface TmdbApi {
  /** Whether a TMDB key is stored (never reveals the key itself). */
  getStatus(): Promise<Result<TmdbKeyStatus>>
  /** Store/replace the TMDB key (encrypted). Empty string clears it. */
  setKey(key: string): Promise<Result<TmdbKeyStatus>>
  clearKey(): Promise<Result<TmdbKeyStatus>>
}

export interface CatalogApi {
  listCategories(): Promise<Result<VodCategory[]>>
  listStreams(req: ListStreamsRequest): Promise<Result<Page<VodStream>>>
  getInfo(streamId: number): Promise<Result<VodInfo>>
  search(req: SearchRequest): Promise<Result<Page<VodStream>>>
  refresh(req: RefreshCatalogRequest): Promise<Result<RefreshCatalogResult>>
}

export interface SeriesApi {
  listCategories(): Promise<Result<SeriesCategory[]>>
  list(req: ListSeriesRequest): Promise<Result<Page<SeriesStream>>>
  getInfo(seriesId: number): Promise<Result<SeriesInfo>>
  search(req: SearchSeriesRequest): Promise<Result<Page<SeriesStream>>>
  refresh(req: RefreshCatalogRequest): Promise<Result<RefreshSeriesResult>>
}

export interface LiveApi {
  listCategories(): Promise<Result<LiveCategory[]>>
  list(req: ListLiveRequest): Promise<Result<Page<LiveStream>>>
  search(req: SearchLiveRequest): Promise<Result<Page<LiveStream>>>
  refresh(req: RefreshCatalogRequest): Promise<Result<RefreshLiveResult>>
  /** Now/next programmes for a channel (empty when no EPG). */
  epg(streamId: number, limit?: number): Promise<Result<EpgEntry[]>>
}

export interface FavoritesApi {
  /** List favorites of a kind (newest first), each with its `available` flag. */
  list(kind: FavoriteKind): Promise<Result<FavoriteItem[]>>
  /** Pin a favorite (idempotent; refreshes the snapshot). */
  add(req: AddFavoriteRequest): Promise<Result<{ ok: true }>>
  /** Unpin a favorite. */
  remove(kind: FavoriteKind, itemId: number): Promise<Result<{ ok: true }>>
}

export interface DownloadsApi {
  add(req: AddDownloadRequest): Promise<Result<DownloadItem>>
  list(): Promise<Result<DownloadItem[]>>
  pause(id: number): Promise<Result<DownloadItem>>
  resume(id: number): Promise<Result<DownloadItem>>
  cancel(id: number): Promise<Result<DownloadItem>>
  reorder(req: ReorderQueueRequest): Promise<Result<DownloadItem[]>>
  clearCompleted(): Promise<Result<{ removed: number }>>
  /**
   * Resolve the on-disk path of an already-downloaded movie for local playback.
   * Returns `{ path: null }` if not downloaded or the file no longer exists.
   */
  localPath(streamId: number, kind?: DownloadKind): Promise<Result<LocalPathResult>>
  /** Subscribe to per-item byte/speed/ETA progress ticks. */
  onProgress(cb: (e: DownloadProgressEvent) => void): Unsubscribe
  /** Subscribe to status transitions (completed/failed/etc.). */
  onState(cb: (e: DownloadStateEvent) => void): Unsubscribe
}

export interface PlayerApi {
  play(req: PlayRequest): Promise<Result<PlayerStatus>>
  pause(): Promise<Result<PlayerStatus>>
  resume(): Promise<Result<PlayerStatus>>
  stop(): Promise<Result<PlayerStatus>>
  seek(req: SeekRequest): Promise<Result<PlayerStatus>>
  setVolume(req: VolumeRequest): Promise<Result<PlayerStatus>>
  setFullscreen(req: FullscreenRequest): Promise<Result<PlayerStatus>>
  status(): Promise<Result<PlayerStatus>>
  /** Cycle to the next embedded subtitle track. */
  cycleSubtitle(): Promise<Result<PlayerStatus>>
  /** Cycle to the next audio track. */
  cycleAudio(): Promise<Result<PlayerStatus>>
  /** Show/hide subtitles. */
  setSubtitleVisible(req: SubtitleVisibleRequest): Promise<Result<PlayerStatus>>
  onPosition(cb: (e: PlayerPositionEvent) => void): Unsubscribe
  onState(cb: (e: PlayerStateEvent) => void): Unsubscribe
}

export interface ConnectionLockApi {
  /** Subscribe to "connection busy" changes (download vs playback contention). */
  onBusyChange(
    cb: (e: { busy: boolean; reason: 'download' | 'playback' | null }) => void
  ): Unsubscribe
}

/** The complete API exposed at `window.api`. */
export interface RendererApi {
  app: AppApi
  connection: ConnectionApi
  settings: SettingsApi
  tmdb: TmdbApi
  catalog: CatalogApi
  series: SeriesApi
  live: LiveApi
  favorites: FavoritesApi
  downloads: DownloadsApi
  player: PlayerApi
  connectionLock: ConnectionLockApi
}
