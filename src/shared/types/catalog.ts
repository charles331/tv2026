/**
 * Catalogue domain types (VOD categories / streams / info).
 * Field names mirror the Xtream Codes player_api.php responses where practical,
 * normalized to camelCase. xtream-api-specialist maps raw API -> these types.
 */

export interface VodCategory {
  categoryId: string
  categoryName: string
  parentId: number
  /** Number of streams in this category, if known (from cache aggregation). */
  streamCount?: number
}

/** A movie entry as listed in a category grid (lightweight). */
export interface VodStream {
  streamId: number
  name: string
  /** Poster / cover image URL. */
  streamIcon: string | null
  /** TMDB / provider rating (0-10), if present. */
  rating: number | null
  /** Container extension, e.g. "mkv", "mp4", "ts". */
  containerExtension: string
  categoryId: string
  /** Release year if parseable. */
  year: number | null
  /** Unix epoch seconds when added to provider catalog. */
  addedAt: number | null
  /** True if a completed local download exists for this stream. */
  downloaded?: boolean
}

/** Full detail for a movie (from get_vod_info). */
export interface VodInfo {
  streamId: number
  name: string
  /** Original/clean title. */
  title: string | null
  year: number | null
  plot: string | null
  cast: string | null
  director: string | null
  genre: string | null
  /** Runtime in seconds, if known. */
  durationSecs: number | null
  rating: number | null
  posterUrl: string | null
  backdropUrls: string[]
  /** YouTube trailer URL or id. */
  trailer: string | null
  containerExtension: string
  /** Size in bytes if reported. */
  sizeBytes: number | null
  /** Provider-reported bitrate. */
  bitrate: number | null
  /** TMDB id from the provider, if known — used to fetch the live TMDB rating. */
  tmdbId: number | null
  /** Live TMDB rating (0-10), fetched on demand when a TMDB API key is set. */
  tmdbRating: number | null
  /** Number of TMDB votes backing `tmdbRating`. */
  tmdbVoteCount: number | null
}

/** Catalogue listing request, with optional category filter. */
export interface ListStreamsRequest {
  /** Filter by category; null/undefined = all categories. */
  categoryId?: string | null
  page: number
  pageSize: number
  /** Sort field. */
  sortBy?: 'name' | 'addedAt' | 'rating' | 'year'
  sortDir?: 'asc' | 'desc'
}

/** Free-text search request across cached titles (26k+ rows). */
export interface SearchRequest {
  query: string
  /** Optional category constraint. */
  categoryId?: string | null
  page: number
  pageSize: number
}

/** Force-refresh control for the catalogue cache. */
export interface RefreshCatalogRequest {
  /** If true, refetch categories + streams from the provider into the cache. */
  force: boolean
}

export interface RefreshCatalogResult {
  categories: number
  streams: number
  /** Unix epoch ms of this refresh. */
  refreshedAt: number
}
