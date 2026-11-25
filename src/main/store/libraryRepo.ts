/**
 * Typed repository for library_items: the video files on disk shown in the
 * Bibliothèque. Filled by finished downloads / recordings, the one-time
 * backfill from download_history and the folder scan ("Actualiser").
 */

import type { LibraryItem, LibraryKind, LibrarySource } from '@shared/index'
import { getDb } from './db'
import { pathKey } from '../library/libraryLogic'

interface LibraryRow {
  id: number
  kind: LibraryKind
  source: LibrarySource
  stream_id: number | null
  series_id: number | null
  series_name: string | null
  season: number | null
  episode: number | null
  title: string
  image: string | null
  file_path: string
  size_bytes: number | null
  container_extension: string | null
  added_at: number
}

function mapRow(r: LibraryRow): LibraryItem {
  return {
    id: r.id,
    kind: r.kind,
    source: r.source,
    streamId: r.stream_id,
    seriesId: r.series_id,
    seriesName: r.series_name,
    season: r.season,
    episode: r.episode,
    title: r.title,
    image: r.image,
    filePath: r.file_path,
    sizeBytes: r.size_bytes,
    addedAt: r.added_at,
    containerExtension: r.container_extension
  }
}

export type NewLibraryItem = Omit<LibraryItem, 'id' | 'addedAt'> & { addedAt?: number }

/** Insert, or update the entry of the same file (idempotent). */
export function upsertLibraryItem(item: NewLibraryItem): LibraryItem {
  const db = getDb()
  const existing = findLibraryItemByPath(item.filePath)
  if (existing) {
    db.prepare(
      `UPDATE library_items SET kind = ?, source = ?, stream_id = ?, series_id = ?, series_name = ?,
         season = ?, episode = ?, title = ?, image = ?, size_bytes = ?, container_extension = ?
       WHERE id = ?`
    ).run(
      item.kind,
      item.source,
      item.streamId,
      item.seriesId,
      item.seriesName,
      item.season,
      item.episode,
      item.title,
      item.image,
      item.sizeBytes,
      item.containerExtension,
      existing.id
    )
    return getLibraryItem(existing.id)!
  }
  const info = db
    .prepare(
      `INSERT INTO library_items
         (kind, source, stream_id, series_id, series_name, season, episode, title, image,
          file_path, size_bytes, container_extension, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      item.kind,
      item.source,
      item.streamId,
      item.seriesId,
      item.seriesName,
      item.season,
      item.episode,
      item.title,
      item.image,
      item.filePath,
      item.sizeBytes,
      item.containerExtension,
      item.addedAt ?? Date.now()
    )
  return getLibraryItem(Number(info.lastInsertRowid))!
}

/** Most recently added first. */
export function listLibraryItems(): LibraryItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM library_items ORDER BY added_at DESC, id DESC')
    .all() as LibraryRow[]
  return rows.map(mapRow)
}

export function getLibraryItem(id: number): LibraryItem | null {
  const row = getDb().prepare('SELECT * FROM library_items WHERE id = ?').get(id) as
    LibraryRow | undefined
  return row ? mapRow(row) : null
}

/** Most recent entry of a catalogue movie or episode (by its stream id). */
export function findLibraryItemByStream(
  streamId: number,
  kind: 'movie' | 'episode'
): LibraryItem | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM library_items WHERE stream_id = ? AND kind = ? ORDER BY added_at DESC, id DESC LIMIT 1'
    )
    .get(streamId, kind) as LibraryRow | undefined
  return row ? mapRow(row) : null
}

/** Entry of a file, compared with pathKey (case-insensitive on Windows). */
export function findLibraryItemByPath(filePath: string): LibraryItem | null {
  const key = pathKey(filePath)
  return listLibraryItems().find((it) => pathKey(it.filePath) === key) ?? null
}

export function removeLibraryItems(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const del = db.prepare('DELETE FROM library_items WHERE id = ?')
  db.transaction((list: number[]) => {
    for (const id of list) del.run(id)
  })(ids)
}

export function updateLibraryItemSize(id: number, sizeBytes: number): void {
  getDb().prepare('UPDATE library_items SET size_bytes = ? WHERE id = ?').run(sizeBytes, id)
}

/** Small flags of the Bibliothèque (e.g. the one-time backfill is done). */
export function getLibraryFlag(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM library_meta WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setLibraryFlag(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO library_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}
