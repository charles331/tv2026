/**
 * Series (TV) domain types — the VOD-series counterpart of catalog.ts.
 * Normalized to camelCase from the Xtream `get_series*` endpoints.
 *
 * Episode playback/download uses the per-episode id in the URL
 * `/series/USER/PASS/{episodeId}.{containerExtension}` (NOT the series id).
 */

/** A series category (same shape as a VOD category). */
export interface SeriesCategory {
  categoryId: string
  categoryName: string
  parentId: number
  /** Number of series in this category, if known (from cache aggregation). */
  seriesCount?: number
}

/** A series as listed in a category grid (lightweight). */
export interface SeriesStream {
  seriesId: number
  name: string
  /** Poster / cover image URL. */
  cover: string | null
  /** Provider rating (0-10), if present. */
  rating: number | null
  categoryId: string
  /** Release year if parseable. */
  year: number | null
  /** Unix epoch seconds of the provider's last modification, if known. */
  lastModified: number | null
  plot: string | null
  genre: string | null
}

/** A single episode within a season. */
export interface Episode {
  /** Stream id used in `/series/USER/PASS/{episodeId}.{ext}`. */
  episodeId: number
  title: string
  /** Season number this episode belongs to. */
  season: number
  /** Episode number within its season. */
  episodeNum: number
  /** Container extension, e.g. "mkv", "mp4", "ts". */
  containerExtension: string
  /** Runtime in seconds, if known. */
  durationSecs: number | null
  plot: string | null
  rating: number | null
  /** Still / thumbnail image, if any. */
  image: string | null
}

/** A season with its ordered episodes. */
export interface Season {
  seasonNumber: number
  name: string | null
  episodes: Episode[]
}

/** Full detail for a series (from get_series_info). */
export interface SeriesInfo {
  seriesId: number
  name: string
  plot: string | null
  cast: string | null
  director: string | null
  genre: string | null
  year: number | null
  rating: number | null
  cover: string | null
  backdropUrls: string[]
  /** YouTube trailer URL or id. */
  trailer: string | null
  /** Seasons in ascending order, each with its episodes. */
  seasons: Season[]
}

/** Catalogue listing request for series, with optional category filter. */
export interface ListSeriesRequest {
  categoryId?: string | null
  page: number
  pageSize: number
  sortBy?: 'name' | 'lastModified' | 'rating' | 'year'
  sortDir?: 'asc' | 'desc'
}

/** Free-text search across cached series titles. */
export interface SearchSeriesRequest {
  query: string
  categoryId?: string | null
  page: number
  pageSize: number
}

/** Result of refreshing the series cache from the provider. */
export interface RefreshSeriesResult {
  categories: number
  series: number
  /** Unix epoch ms of this refresh. */
  refreshedAt: number
}
