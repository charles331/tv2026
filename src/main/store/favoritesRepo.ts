/**
 * Typed repository for the `favorites` table (movies / series / live).
 *
 * A favorite stores a snapshot so it survives a catalogue purge. `available` is
 * derived live by checking whether the item still exists in the matching cache
 * table (vod_streams / series / live_streams) — that's the "offline" status.
 */

import type { AddFavoriteRequest, FavoriteItem, FavoriteKind } from '@shared/index'
import { getDb } from './db'

interface FavRow {
  kind: FavoriteKind
  item_id: number
  name: string
  image: string | null
  container_extension: string | null
  category_id: string | null
  added_at: number
  available: number
}

/** SQL expression telling whether a favorite row still exists in its cache. */
const AVAILABLE_EXPR = `
  CASE f.kind
    WHEN 'movie'  THEN EXISTS(SELECT 1 FROM vod_streams  v WHERE v.stream_id = f.item_id)
    WHEN 'series' THEN EXISTS(SELECT 1 FROM series       s WHERE s.series_id = f.item_id)
    WHEN 'live'   THEN EXISTS(SELECT 1 FROM live_streams l WHERE l.stream_id = f.item_id)
    ELSE 0
  END`

function mapRow(r: FavRow): FavoriteItem {
  return {
    kind: r.kind,
    itemId: r.item_id,
    name: r.name,
    image: r.image,
    containerExtension: r.container_extension,
    categoryId: r.category_id,
    addedAt: r.added_at,
    available: Boolean(r.available)
  }
}

export function addFavorite(f: AddFavoriteRequest): void {
  getDb()
    .prepare(
      `INSERT INTO favorites (kind, item_id, name, image, container_extension, category_id, added_at)
       VALUES (@kind, @itemId, @name, @image, @containerExtension, @categoryId, @addedAt)
       ON CONFLICT(kind, item_id) DO UPDATE SET
         name = excluded.name,
         image = excluded.image,
         container_extension = excluded.container_extension,
         category_id = excluded.category_id`
    )
    .run({
      kind: f.kind,
      itemId: f.itemId,
      name: f.name,
      image: f.image ?? null,
      containerExtension: f.containerExtension ?? null,
      categoryId: f.categoryId ?? null,
      addedAt: Date.now()
    })
}

export function removeFavorite(kind: FavoriteKind, itemId: number): void {
  getDb().prepare('DELETE FROM favorites WHERE kind = ? AND item_id = ?').run(kind, itemId)
}

export function isFavorite(kind: FavoriteKind, itemId: number): boolean {
  return Boolean(
    getDb().prepare('SELECT 1 FROM favorites WHERE kind = ? AND item_id = ? LIMIT 1').get(kind, itemId)
  )
}

/** List favorites of a kind (newest first), each with its live `available` flag. */
export function listFavorites(kind: FavoriteKind): FavoriteItem[] {
  const rows = getDb()
    .prepare(
      `SELECT f.kind, f.item_id, f.name, f.image, f.container_extension, f.category_id, f.added_at,
              ${AVAILABLE_EXPR} AS available
       FROM favorites f
       WHERE f.kind = ?
       ORDER BY f.added_at DESC`
    )
    .all(kind) as FavRow[]
  return rows.map(mapRow)
}

/** Per-kind counts (for the sidebar "Favoris" badge). */
export function favoriteCount(kind: FavoriteKind): number {
  return (
    getDb().prepare('SELECT COUNT(*) AS n FROM favorites WHERE kind = ?').get(kind) as { n: number }
  ).n
}
