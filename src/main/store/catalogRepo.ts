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
  VodInfo,
  VodStream
} from '@shared/index'
import { getDb } from './db'

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
    downloaded: r.downloaded ? Boolean(r.downloaded) : false
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

  const where = req.categoryId ? 'WHERE category_id = ?' : ''
  const params = req.categoryId ? [req.categoryId] : []

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM vod_streams ${where}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT s.*,
              EXISTS(SELECT 1 FROM download_history h
                     WHERE h.stream_id = s.stream_id AND h.status = 'completed') AS downloaded
       FROM vod_streams s ${where}
       ORDER BY ${sortCol} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as StreamRow[]

  return { items: rows.map(mapStream), page, pageSize, total }
}

export function searchStreams(req: SearchRequest): Page<VodStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(200, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  const like = `%${req.query.replace(/[%_]/g, (m) => '\\' + m)}%`

  const catClause = req.categoryId ? 'AND category_id = ?' : ''
  const baseParams: (string | number)[] = [like]
  if (req.categoryId) baseParams.push(req.categoryId)

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM vod_streams WHERE name LIKE ? ESCAPE '\\' ${catClause}`)
      .get(...baseParams) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT s.*,
              EXISTS(SELECT 1 FROM download_history h
                     WHERE h.stream_id = s.stream_id AND h.status = 'completed') AS downloaded
       FROM vod_streams s
       WHERE name LIKE ? ESCAPE '\\' ${catClause}
       ORDER BY name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...baseParams, pageSize, offset) as StreamRow[]

  return { items: rows.map(mapStream), page, pageSize, total }
}

export function getStream(streamId: number): VodStream | null {
  const row = getDb()
    .prepare('SELECT * FROM vod_streams WHERE stream_id = ?')
    .get(streamId) as StreamRow | undefined
  return row ? mapStream(row) : null
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

/** Counts for refresh reporting. */
export function catalogCounts(): { categories: number; streams: number } {
  const db = getDb()
  return {
    categories: (db.prepare('SELECT COUNT(*) AS n FROM vod_categories').get() as { n: number }).n,
    streams: (db.prepare('SELECT COUNT(*) AS n FROM vod_streams').get() as { n: number }).n
  }
}
