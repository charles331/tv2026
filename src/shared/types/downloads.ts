/**
 * Download queue / engine domain types.
 * download-engineer implements the real engine against these contracts.
 * The 1-connection constraint => the queue is processed sequentially.
 */

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled'

/** What kind of stream a download targets (different provider URL per kind). */
export type DownloadKind = 'movie' | 'series'

export interface DownloadItem {
  /** Internal queue id (DB primary key). */
  id: number
  /**
   * Provider stream id: a movie stream_id for `kind: 'movie'`, or an episode id
   * for `kind: 'series'` (used in the /series/.. URL).
   */
  streamId: number
  /** Movie vs series episode — selects the provider URL builder. */
  kind: DownloadKind
  /** Display name for the item. */
  name: string
  /** Final filename (resolved from template), e.g. "Dune (2021).mkv". */
  fileName: string
  /** Absolute destination path of the final file. */
  destPath: string
  containerExtension: string
  status: DownloadStatus
  /** Total bytes if known (from Content-Length / Content-Range). */
  totalBytes: number | null
  /** Bytes already written to the .part file. */
  receivedBytes: number
  /** 0..1 progress, or null when total unknown. */
  progress: number | null
  /** Position in the queue (lower runs first); for reordering. */
  queuePosition: number
  /** Last error message if status === 'failed'. */
  error: string | null
  /** Unix epoch ms. */
  createdAt: number
  updatedAt: number
}

/** Request to enqueue a download. */
export interface AddDownloadRequest {
  streamId: number
  name: string
  containerExtension: string
  /** Movie (default) or series episode. */
  kind?: DownloadKind
  /** Optional override of the destination filename. */
  fileName?: string
}

/** Reorder request: full ordered list of queue item ids. */
export interface ReorderQueueRequest {
  /** Item ids in the desired processing order. */
  orderedIds: number[]
}

/**
 * Result of resolving the local file path of an already-downloaded movie.
 * `path` is non-null only when a completed download exists AND the file is still
 * present on disk; otherwise `path` is null (caller falls back to streaming).
 */
export interface LocalPathResult {
  path: string | null
}

/**
 * Progress event pushed from main -> renderer on the
 * {@link DownloadEventChannels.PROGRESS} channel.
 */
export interface DownloadProgressEvent {
  id: number
  streamId: number
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number | null
  progress: number | null
  /** Instantaneous speed in bytes/sec. */
  speedBps: number
  /** Estimated seconds remaining, or null. */
  etaSecs: number | null
}

/** Lifecycle event (state transitions, completion, failure). */
export interface DownloadStateEvent {
  id: number
  streamId: number
  status: DownloadStatus
  /** Set when status === 'failed'. */
  error?: string
  /** Set when status === 'completed' — final absolute path. */
  destPath?: string
}
