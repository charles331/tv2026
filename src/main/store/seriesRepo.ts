/**
 * Typed repository for the cached series catalogue:
 * series_categories, series, series_info_cache. Mirrors catalogRepo.
 */

import type {
  ListSeriesRequest,
  Page,
  SearchSeriesRequest,
  SeriesCategory,
  SeriesInfo,
  SeriesStream
} from '@shared/index'
import { getDb } from './db'

interface CategoryRow {
  category_id: string
  category_name: string
  parent_id: number
  series_count?: number
}

interface SeriesRow {
  series_id: number
  name: string
  cover: string | null
  rating: number | null
  category_id: string | null
  year: number | null
  last_modified: number | null
  plot: string | null
  genre: string | null
}

function mapCategory(r: CategoryRow): SeriesCategory {
  return {
    categoryId: r.category_id,
    categoryName: r.category_name,
    parentId: r.parent_id,
    seriesCount: r.series_count
  }
}

function mapSeries(r: SeriesRow): SeriesStream {
  return {
    seriesId: r.series_id,
    name: r.name,
    cover: r.cover,
    rating: r.rating,
    categoryId: r.category_id ?? '',
    year: r.year,
    lastModified: r.last_modified,
    plot: r.plot,
    genre: r.genre
  }
}

// --- categories ---

export function upsertCategories(categories: SeriesCategory[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO series_categories (category_id, category_name, parent_id, updated_at)
     VALUES (@categoryId, @categoryName, @parentId, @now)
     ON CONFLICT(category_id) DO UPDATE SET
       category_name = excluded.category_name,
       parent_id     = excluded.parent_id,
       updated_at    = excluded.updated_at`
  )
  const tx = db.transaction((items: SeriesCategory[]) => {
    for (const c of items) {
      stmt.run({ categoryId: c.categoryId, categoryName: c.categoryName, parentId: c.parentId, now })
    }
  })
  tx(categories)
}

export function listCategories(): SeriesCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT c.category_id, c.category_name, c.parent_id,
              (SELECT COUNT(*) FROM series s WHERE s.category_id = c.category_id) AS series_count
       FROM series_categories c
       ORDER BY c.category_name COLLATE NOCASE`
    )
    .all() as CategoryRow[]
  return rows.map(mapCategory)
}

// --- series ---

export function upsertSeries(series: SeriesStream[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO series
       (series_id, name, cover, rating, category_id, year, last_modified, plot, genre, updated_at)
     VALUES
       (@seriesId, @name, @cover, @rating, @categoryId, @year, @lastModified, @plot, @genre, @now)
     ON CONFLICT(series_id) DO UPDATE SET
       name          = excluded.name,
       cover         = excluded.cover,
       rating        = excluded.rating,
       category_id   = excluded.category_id,
       year          = excluded.year,
       last_modified = excluded.last_modified,
       plot          = excluded.plot,
       genre         = excluded.genre,
       updated_at    = excluded.updated_at`
  )
  const tx = db.transaction((items: SeriesStream[]) => {
    for (const s of items) {
      stmt.run({
        seriesId: s.seriesId,
        name: s.name,
        cover: s.cover,
        rating: s.rating,
        categoryId: s.categoryId || null,
        year: s.year,
        lastModified: s.lastModified,
        plot: s.plot,
        genre: s.genre,
        now
      })
    }
  })
  tx(series)
}

const SORT_COLUMNS: Record<NonNullable<ListSeriesRequest['sortBy']>, string> = {
  name: 'name COLLATE NOCASE',
  lastModified: 'last_modified',
  rating: 'rating',
  year: 'year'
}

export function listSeries(req: ListSeriesRequest): Page<SeriesStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(200, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  const sortCol = SORT_COLUMNS[req.sortBy ?? 'name'] ?? 'name COLLATE NOCASE'
  const dir = req.sortDir === 'desc' ? 'DESC' : 'ASC'

  const where = req.categoryId ? 'WHERE category_id = ?' : ''
  const params = req.categoryId ? [req.categoryId] : []

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM series ${where}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(`SELECT * FROM series ${where} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as SeriesRow[]

  return { items: rows.map(mapSeries), page, pageSize, total }
}

export function searchSeries(req: SearchSeriesRequest): Page<SeriesStream> {
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
      .prepare(`SELECT COUNT(*) AS n FROM series WHERE name LIKE ? ESCAPE '\\' ${catClause}`)
      .get(...baseParams) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT * FROM series
       WHERE name LIKE ? ESCAPE '\\' ${catClause}
       ORDER BY name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...baseParams, pageSize, offset) as SeriesRow[]

  return { items: rows.map(mapSeries), page, pageSize, total }
}

export function getSeries(seriesId: number): SeriesStream | null {
  const row = getDb()
    .prepare('SELECT * FROM series WHERE series_id = ?')
    .get(seriesId) as SeriesRow | undefined
  return row ? mapSeries(row) : null
}

// --- info cache ---

export function cacheSeriesInfo(info: SeriesInfo): void {
  getDb()
    .prepare(
      `INSERT INTO series_info_cache (series_id, info_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(series_id) DO UPDATE SET
         info_json = excluded.info_json, fetched_at = excluded.fetched_at`
    )
    .run(info.seriesId, JSON.stringify(info), Date.now())
}

export function getCachedSeriesInfo(seriesId: number, maxAgeMs?: number): SeriesInfo | null {
  const row = getDb()
    .prepare('SELECT info_json, fetched_at FROM series_info_cache WHERE series_id = ?')
    .get(seriesId) as { info_json: string; fetched_at: number } | undefined
  if (!row) return null
  if (maxAgeMs !== undefined && Date.now() - row.fetched_at > maxAgeMs) return null
  try {
    return JSON.parse(row.info_json) as SeriesInfo
  } catch {
    return null
  }
}

export function seriesCounts(): { categories: number; series: number } {
  const db = getDb()
  return {
    categories: (db.prepare('SELECT COUNT(*) AS n FROM series_categories').get() as { n: number })
      .n,
    series: (db.prepare('SELECT COUNT(*) AS n FROM series').get() as { n: number }).n
  }
}
