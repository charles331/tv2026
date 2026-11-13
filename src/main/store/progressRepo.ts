/**
 * Typed repository for the `watch_progress` table: resume positions and
 * "watched" flags of movies and episodes, plus the recently watched live
 * channels. A row carries a snapshot (name/image/…), like favorites.
 */

import type { ProgressKind, WatchProgress } from '@shared/index'
import { getDb } from './db'

interface ProgressRow {
  kind: ProgressKind
  item_id: number
  position_secs: number
  duration_secs: number | null
  watched: number
  updated_at: number
  name: string
  image: string | null
  container_extension: string | null
  series_id: number | null
}

/** Live channels kept in the "recently watched" list. */
const RECENT_CHANNELS_KEPT = 30

function mapRow(r: ProgressRow): WatchProgress {
  return {
    kind: r.kind,
    itemId: r.item_id,
    positionSecs: r.position_secs,
    durationSecs: r.duration_secs,
    watched: r.watched === 1,
    updatedAt: r.updated_at,
    name: r.name,
    image: r.image,
    containerExtension: r.container_extension,
    seriesId: r.series_id
  }
}

/** Insert or replace the progress of one item (stamped now). */
export function saveProgress(p: Omit<WatchProgress, 'updatedAt'>): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO watch_progress
       (kind, item_id, position_secs, duration_secs, watched, updated_at,
        name, image, container_extension, series_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, item_id) DO UPDATE SET
       position_secs = excluded.position_secs,
       duration_secs = COALESCE(excluded.duration_secs, watch_progress.duration_secs),
       watched = excluded.watched,
       updated_at = excluded.updated_at,
       name = excluded.name,
       image = COALESCE(excluded.image, watch_progress.image),
       container_extension = COALESCE(excluded.container_extension, watch_progress.container_extension),
       series_id = COALESCE(excluded.series_id, watch_progress.series_id)`
  ).run(
    p.kind,
    p.itemId,
    p.positionSecs,
    p.durationSecs,
    p.watched ? 1 : 0,
    Date.now(),
    p.name,
    p.image,
    p.containerExtension,
    p.seriesId
  )
  if (p.kind === 'live') {
    // Keep only the most recent channels.
    db.prepare(
      `DELETE FROM watch_progress WHERE kind = 'live' AND item_id NOT IN (
         SELECT item_id FROM watch_progress WHERE kind = 'live'
         ORDER BY updated_at DESC LIMIT ?)`
    ).run(RECENT_CHANNELS_KEPT)
  }
}

/** Every progress row, most recent first (a small table: only what was played). */
export function listProgress(): WatchProgress[] {
  const rows = getDb()
    .prepare('SELECT * FROM watch_progress ORDER BY updated_at DESC LIMIT 2000')
    .all() as ProgressRow[]
  return rows.map(mapRow)
}

export function getProgress(kind: ProgressKind, itemId: number): WatchProgress | null {
  const row = getDb()
    .prepare('SELECT * FROM watch_progress WHERE kind = ? AND item_id = ?')
    .get(kind, itemId) as ProgressRow | undefined
  return row ? mapRow(row) : null
}

export function removeProgress(kind: ProgressKind, itemId: number): void {
  getDb().prepare('DELETE FROM watch_progress WHERE kind = ? AND item_id = ?').run(kind, itemId)
}
