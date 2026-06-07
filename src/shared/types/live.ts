/**
 * Live TV domain types — channels, categories and short EPG (now/next).
 *
 * Live playback streams from `/live/USER/PASS/{streamId}.{ext}` (default `.ts`).
 * Live is playback-only (no download) and consumes the single provider
 * connection, so it acquires the ConnectionLock like any other stream.
 *
 * EPG titles/descriptions arrive base64-encoded from the provider; the client
 * decodes them. The short EPG is volatile and fetched on demand (not persisted).
 */

/** A live category (same shape as a VOD/series category). */
export interface LiveCategory {
  categoryId: string
  categoryName: string
  parentId: number
  /** Number of channels in this category, if known (from cache aggregation). */
  channelCount?: number
}

/** A live TV channel as listed in a category. */
export interface LiveStream {
  streamId: number
  name: string
  /** Channel logo URL. */
  icon: string | null
  /** Channel number shown in the guide (provider `num`), if any. */
  number: number | null
  /** EPG channel id used to fetch the programme guide, if any. */
  epgChannelId: string | null
  categoryId: string
  /** Whether catch-up/archive is available for this channel. */
  hasArchive: boolean
}

/** One programme in the EPG (short now/next or full guide). */
export interface EpgEntry {
  title: string
  description: string | null
  /** Unix epoch seconds. */
  startSecs: number | null
  endSecs: number | null
  /** True for the programme currently on air. */
  nowPlaying: boolean
  /** Provider EPG id (`id`/`epg_id`) if present — not guaranteed stable. */
  epgId: string | null
}

/** Listing request for live channels, with optional category filter. */
export interface ListLiveRequest {
  categoryId?: string | null
  page: number
  pageSize: number
  sortBy?: 'name' | 'number'
  sortDir?: 'asc' | 'desc'
}

/** Free-text search across cached channel names. */
export interface SearchLiveRequest {
  query: string
  categoryId?: string | null
  page: number
  pageSize: number
}

/** Short-EPG request: now + next programmes for one channel. */
export interface ShortEpgRequest {
  streamId: number
  /** How many upcoming programmes to return (default 2 = now + next). */
  limit?: number
}

/** Full-EPG request: the complete guide for one channel. */
export interface FullEpgRequest {
  streamId: number
}

/** Result of refreshing the live cache from the provider. */
export interface RefreshLiveResult {
  categories: number
  channels: number
  /** Unix epoch ms of this refresh. */
  refreshedAt: number
}
