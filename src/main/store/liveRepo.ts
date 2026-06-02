/**
 * Typed repository for the cached live catalogue: live_categories, live_streams.
 * Mirrors catalogRepo/seriesRepo. The EPG is volatile and never persisted here.
 */

import type {
  ListLiveRequest,
  LiveCategory,
  LiveStream,
  Page,
  SearchLiveRequest
} from '@shared/index'
import { getDb } from './db'

interface CategoryRow {
  category_id: string
  category_name: string
  parent_id: number
  channel_count?: number
}

interface ChannelRow {
  stream_id: number
  name: string
  icon: string | null
  number: number | null
  epg_channel_id: string | null
  category_id: string | null
  has_archive: number
}

function mapCategory(r: CategoryRow): LiveCategory {
  return {
    categoryId: r.category_id,
    categoryName: r.category_name,
    parentId: r.parent_id,
    channelCount: r.channel_count
  }
}

function mapChannel(r: ChannelRow): LiveStream {
  return {
    streamId: r.stream_id,
    name: r.name,
    icon: r.icon,
    number: r.number,
    epgChannelId: r.epg_channel_id,
    categoryId: r.category_id ?? '',
    hasArchive: Boolean(r.has_archive)
  }
}

// --- categories ---

export function upsertCategories(categories: LiveCategory[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO live_categories (category_id, category_name, parent_id, updated_at)
     VALUES (@categoryId, @categoryName, @parentId, @now)
     ON CONFLICT(category_id) DO UPDATE SET
       category_name = excluded.category_name,
       parent_id     = excluded.parent_id,
       updated_at    = excluded.updated_at`
  )
  const tx = db.transaction((items: LiveCategory[]) => {
    for (const c of items) {
      stmt.run({ categoryId: c.categoryId, categoryName: c.categoryName, parentId: c.parentId, now })
    }
  })
  tx(categories)
}

export function listCategories(): LiveCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT c.category_id, c.category_name, c.parent_id,
              (SELECT COUNT(*) FROM live_streams s WHERE s.category_id = c.category_id) AS channel_count
       FROM live_categories c
       ORDER BY c.category_name COLLATE NOCASE`
    )
    .all() as CategoryRow[]
  return rows.map(mapCategory)
}

// --- channels ---

export function upsertChannels(channels: LiveStream[]): void {
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO live_streams
       (stream_id, name, icon, number, epg_channel_id, category_id, has_archive, updated_at)
     VALUES
       (@streamId, @name, @icon, @number, @epgChannelId, @categoryId, @hasArchive, @now)
     ON CONFLICT(stream_id) DO UPDATE SET
       name           = excluded.name,
       icon           = excluded.icon,
       number         = excluded.number,
       epg_channel_id = excluded.epg_channel_id,
       category_id    = excluded.category_id,
       has_archive    = excluded.has_archive,
       updated_at     = excluded.updated_at`
  )
  const tx = db.transaction((items: LiveStream[]) => {
    for (const s of items) {
      stmt.run({
        streamId: s.streamId,
        name: s.name,
        icon: s.icon,
        number: s.number,
        epgChannelId: s.epgChannelId,
        categoryId: s.categoryId || null,
        hasArchive: s.hasArchive ? 1 : 0,
        now
      })
    }
  })
  tx(channels)
}

const SORT_COLUMNS: Record<NonNullable<ListLiveRequest['sortBy']>, string> = {
  // Channels without a number sort last when ordering by number.
  number: 'number IS NULL, number',
  name: 'name COLLATE NOCASE'
}

export function listChannels(req: ListLiveRequest): Page<LiveStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(500, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  const sortCol = SORT_COLUMNS[req.sortBy ?? 'number'] ?? SORT_COLUMNS.number
  const dir = req.sortDir === 'desc' ? 'DESC' : 'ASC'

  const where = req.categoryId ? 'WHERE category_id = ?' : ''
  const params = req.categoryId ? [req.categoryId] : []

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM live_streams ${where}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(`SELECT * FROM live_streams ${where} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as ChannelRow[]

  return { items: rows.map(mapChannel), page, pageSize, total }
}

export function searchChannels(req: SearchLiveRequest): Page<LiveStream> {
  const db = getDb()
  const page = Math.max(1, req.page)
  const pageSize = Math.min(500, Math.max(1, req.pageSize))
  const offset = (page - 1) * pageSize
  const like = `%${req.query.replace(/[%_]/g, (m) => '\\' + m)}%`

  const catClause = req.categoryId ? 'AND category_id = ?' : ''
  const baseParams: (string | number)[] = [like]
  if (req.categoryId) baseParams.push(req.categoryId)

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM live_streams WHERE name LIKE ? ESCAPE '\\' ${catClause}`)
      .get(...baseParams) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT * FROM live_streams
       WHERE name LIKE ? ESCAPE '\\' ${catClause}
       ORDER BY name COLLATE NOCASE ASC
       LIMIT ? OFFSET ?`
    )
    .all(...baseParams, pageSize, offset) as ChannelRow[]

  return { items: rows.map(mapChannel), page, pageSize, total }
}

export function getChannel(streamId: number): LiveStream | null {
  const row = getDb()
    .prepare('SELECT * FROM live_streams WHERE stream_id = ?')
    .get(streamId) as ChannelRow | undefined
  return row ? mapChannel(row) : null
}

export function liveCounts(): { categories: number; channels: number } {
  const db = getDb()
  return {
    categories: (db.prepare('SELECT COUNT(*) AS n FROM live_categories').get() as { n: number }).n,
    channels: (db.prepare('SELECT COUNT(*) AS n FROM live_streams').get() as { n: number }).n
  }
}
