/**
 * Typed repository for the cached catalogue:
 * vod_categories, vod_streams, vod_info_cache.
 * xtream-api-specialist calls upsert* after fetching from the provider;
 * the renderer reads via list/search through the IPC handlers.
 */

import type {
  ListStreamsRequest,
  Page,
  SearchRequest,
  VodCategory,
  VideoInfo,
  VodInfo,
  VodStream
} from '@shared/index'
import { getDb } from './db'
import { nameSearch } from './searchText'

interface CategoryRow {
  category_id: string
  category_name: string
  parent_id: number
  stream_count?: number
}

interface StreamRow {
  stream_id: number
  name: string
  stream_icon: string | null
  rating: number | null
  container_extension: string
  category_id: string | null
  year: number | null
  added_at: number | null
  downloaded?: number
  file_size?: number | null
  file_duration?: number | null
  file_width?: number | null
  file_height?: number | null
  file_codec?: string | null
}

function mapCategory(r: CategoryRow): VodCategory {
  return {
    categoryId: r.category_id,
    categoryName: r.category_name,
    parentId: r.parent_id,
    streamCount: r.stream_count
  }
}

function mapStream(r: StreamRow): VodStream {
  return {
    streamId: r.stream_id,
    name: r.name,
    streamIcon: r.stream_icon,
    rating: r.rating,
    containerExtension: r.container_extension,
    categoryId: r.category_id ?? '',
    year: r.year,
    addedAt: r.added_at,
    downloaded: r.downloaded ? Boolean(r.downloaded) : false,
    fileSizeBytes: r.file_size ?? null,
    fileDurationSecs: r.file_duration ?? null,
    fileVideo:
      r.file_width && r.file_height && r.file_codec
        ? { width: r.file_width, height: r.file_height, codec: r.file_codec }
        : null
  }
}

// --- categories ---

export function upsertCategories(categories: VodCategory[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO vod_categories (category_id, category_name, parent_id, updated_at)
     VALUES (@categoryId, @categoryName, @parentId, @now)
     ON CONFLICT(category_id) DO UPDATE SET
       category_name = excluded.category_name,
       parent_id     = excluded.parent_id,
       updated_at    = excluded.updated_at`
  )
  const tx = db.transaction((items: VodCategory[]) => {
    for (const c of items) {
      stmt.run({ categoryId: c.categoryId, categoryName: c.categoryName, parentId: c.parentId, now })
    }
  })
  tx(categories)
}

export function listCategories(): VodCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT c.category_id, c.category_name, c.parent_id,
              (SELECT COUNT(*) FROM vod_streams s WHERE s.category_id = c.category_id) AS stream_count
       FROM vod_categories c
       ORDER BY c.category_name COLLATE NOCASE`
    )
    .all() as CategoryRow[]
  return rows.map(mapCategory)
}

// --- streams ---

export function upsertStreams(streams: VodStream[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO vod_streams
       (stream_id, name, stream_icon, rating, container_extension, category_id, year, added_at, updated_at)
     VALUES
       (@streamId, @name, @streamIcon, @rating, @containerExtension, @categoryId, @year, @addedAt, @now)
     ON CONFLICT(stream_id) DO UPDATE SET
       name                = excluded.name,
       stream_icon         = excluded.stream_icon,
       rating              = excluded.rating,
       container_extension = excluded.container_extension,
       category_id         = excluded.category_id,
       year                = excluded.year,
       added_at            = excluded.added_at,
       updated_at          = excluded.updated_at`
  )
  const tx = db.transaction((items: VodStream[]) => {
    for (const s of items) {
      stmt.run({
        streamId: s.streamId,
        name: s.name,
        streamIcon: s.streamIcon,
        rating: s.rating,
        containerExtension: s.containerExtension,
        categoryId: s.categoryId || null,
        year: s.year,
        addedAt: s.addedAt,
        now
      })
    }
  })
  tx(streams)
}

const SORT_COLUMNS: Record<NonNullable<ListStreamsRequest['sortBy']>, string> = {
  name: 'name COLLATE NOCASE',
  addedAt: 'added_at',
  rating: 'rating',
  year: 'year'
}

export function listStreams(req: ListStreamsRequest): Page<VodStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(200, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  const sortCol = SORT_COLUMNS[req.sortBy ?? 'name'] ?? 'name COLLATE NOCASE'
  const dir = req.sortDir === 'desc' ? 'DESC' : 'ASC'

  const where = req.categoryId ? 'WHERE s.category_id = ?' : ''
  const params = req.categoryId ? [req.categoryId] : []

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM vod_streams s ${where}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT s.*,
              EXISTS(SELECT 1 FROM download_history h
                     WHERE h.stream_id = s.stream_id AND h.kind = 'movie'
                       AND h.status = 'completed') AS downloaded,
              fc.size_bytes AS file_size, fc.duration_secs AS file_duration,
              fc.width AS file_width, fc.height AS file_height, fc.video_codec AS file_codec
       FROM vod_streams s
       LEFT JOIN vod_file_check fc ON fc.stream_id = s.stream_id ${where}
       ORDER BY ${sortCol} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as StreamRow[]

  return { items: rows.map(mapStream), page, pageSize, total }
}

/** One catalogue movie by id (with its file-check data), or null if not cached. */
export function getStream(streamId: number): VodStream | null {
  const row = getDb()
    .prepare(
      `SELECT s.*,
              EXISTS(SELECT 1 FROM download_history h
                     WHERE h.stream_id = s.stream_id AND h.kind = 'movie'
                       AND h.status = 'completed') AS downloaded,
              fc.size_bytes AS file_size, fc.duration_secs AS file_duration,
              fc.width AS file_width, fc.height AS file_height, fc.video_codec AS file_codec
       FROM vod_streams s
       LEFT JOIN vod_file_check fc ON fc.stream_id = s.stream_id
       WHERE s.stream_id = ?`
    )
    .get(streamId) as StreamRow | undefined
  return row ? mapStream(row) : null
}

export function searchStreams(req: SearchRequest): Page<VodStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(200, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  // Accent-insensitive, words in any order (see searchText.ts).
  const match = nameSearch('s.name', req.query)
  if (!match) return { items: [], page, pageSize, total: 0 }
  const sortCol = SORT_COLUMNS[req.sortBy ?? 'name'] ?? 'name COLLATE NOCASE'
  const dir = req.sortDir === 'desc' ? 'DESC' : 'ASC'

  const catClause = req.categoryId ? 'AND s.category_id = ?' : ''
  const baseParams: (string | number)[] = [...match.params]
  if (req.categoryId) baseParams.push(req.categoryId)

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM vod_streams s WHERE ${match.clause} ${catClause}`)
      .get(...baseParams) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT s.*,
              EXISTS(SELECT 1 FROM download_history h
                     WHERE h.stream_id = s.stream_id AND h.kind = 'movie'
                       AND h.status = 'completed') AS downloaded,
              fc.size_bytes AS file_size, fc.duration_secs AS file_duration,
              fc.width AS file_width, fc.height AS file_height, fc.video_codec AS file_codec
       FROM vod_streams s
       LEFT JOIN vod_file_check fc ON fc.stream_id = s.stream_id
       WHERE ${match.clause} ${catClause}
       ORDER BY ${sortCol} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...baseParams, pageSize, offset) as StreamRow[]

  return { items: rows.map(mapStream), page, pageSize, total }
}

// --- info cache ---

export function cacheVodInfo(info: VodInfo): void {
  getDb()
    .prepare(
      `INSERT INTO vod_info_cache (stream_id, info_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(stream_id) DO UPDATE SET
         info_json = excluded.info_json, fetched_at = excluded.fetched_at`
    )
    .run(info.streamId, JSON.stringify(info), Date.now())
}

/** Returns cached VodInfo if present and fresher than maxAgeMs (if provided). */
export function getCachedVodInfo(streamId: number, maxAgeMs?: number): VodInfo | null {
  const row = getDb()
    .prepare('SELECT info_json, fetched_at FROM vod_info_cache WHERE stream_id = ?')
    .get(streamId) as { info_json: string; fetched_at: number } | undefined
  if (!row) return null
  if (maxAgeMs !== undefined && Date.now() - row.fetched_at > maxAgeMs) return null
  try {
    return JSON.parse(row.info_json) as VodInfo
  } catch {
    return null
  }
}

// --- file checks (quality) ---

export interface FileCheckRow {
  sizeBytes: number
  durationSecs: number | null
  checkedAt: number
  video: VideoInfo | null
}

export function getFileCheck(streamId: number): FileCheckRow | null {
  const r = getDb()
    .prepare(
      `SELECT size_bytes, duration_secs, checked_at, width, height, video_codec
       FROM vod_file_check WHERE stream_id = ?`
    )
    .get(streamId) as
    | {
        size_bytes: number
        duration_secs: number | null
        checked_at: number
        width: number | null
        height: number | null
        video_codec: string | null
      }
    | undefined
  if (!r) return null
  return {
    sizeBytes: r.size_bytes,
    durationSecs: r.duration_secs,
    checkedAt: r.checked_at,
    video:
      r.width && r.height && r.video_codec ? { width: r.width, height: r.height, codec: r.video_codec } : null
  }
}

/** Store the real resolution/codec read from the file ("Analyser"). */
export function saveFileVideo(streamId: number, video: VideoInfo): void {
  getDb()
    .prepare('UPDATE vod_file_check SET width = ?, height = ?, video_codec = ? WHERE stream_id = ?')
    .run(video.width, video.height, video.codec, streamId)
}

export function saveFileCheck(streamId: number, row: Omit<FileCheckRow, 'video'>): void {
  getDb()
    .prepare(
      `INSERT INTO vod_file_check (stream_id, size_bytes, duration_secs, checked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stream_id) DO UPDATE SET size_bytes = excluded.size_bytes,
         duration_secs = excluded.duration_secs, checked_at = excluded.checked_at`
    )
    .run(streamId, row.sizeBytes, row.durationSecs, row.checkedAt)
}

/** Counts for refresh reporting. */
export function catalogCounts(): { categories: number; streams: number } {
  const db = getDb()
  return {
    categories: (db.prepare('SELECT COUNT(*) AS n FROM vod_categories').get() as { n: number }).n,
    streams: (db.prepare('SELECT COUNT(*) AS n FROM vod_streams').get() as { n: number }).n
  }
}
