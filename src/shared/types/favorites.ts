/**
 * Favorites domain types. A favorite is a movie, a series, or a live channel the
 * user pinned. We store a SNAPSHOT (name/image/…) so a favorite still renders
 * even after its source disappears from the provider's catalogue on refresh —
 * in which case `available` becomes false (shown offline/red in the UI).
 */

export type FavoriteKind = 'movie' | 'series' | 'live'

export interface FavoriteItem {
  kind: FavoriteKind
  /** stream_id (movie/live) or series_id. */
  itemId: number
  name: string
  /** Poster / cover / channel logo URL (snapshot). */
  image: string | null
  /** Container extension snapshot (movie/live), for play/download. */
  containerExtension: string | null
  categoryId: string | null
  /** Unix epoch ms when favorited. */
  addedAt: number
  /**
   * True if the item still exists in the current catalogue cache (after the last
   * refresh). False = the source is gone → shown offline. Computed server-side.
   */
  available: boolean
}

/** Request to add (pin) a favorite — carries the snapshot fields. */
export interface AddFavoriteRequest {
  kind: FavoriteKind
  itemId: number
  name: string
  image?: string | null
  containerExtension?: string | null
  categoryId?: string | null
}

/** Identify a favorite for read/remove. */
export interface FavoriteRef {
  kind: FavoriteKind
  itemId: number
}
