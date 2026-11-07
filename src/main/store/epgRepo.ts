/**
 * Local copy of the full programme guide (xmltv.php), for searching programme
 * titles/descriptions across all live channels ("find the Brugge–Anderlecht
 * match"). Only programmes not yet ended, on channels the user actually has,
 * are kept; the whole guide is replaced on each refresh.
 */

import type { GuideSearchHit } from '@shared/index'
import { getDb } from './db'
import { mapChannel, type ChannelRow } from './liveRepo'
import { toFtsQuery } from './ftsQuery'

export interface GuideProgrammeRow {
  channel: string
  startSecs: number
  endSecs: number
  title: string
  description: string | null
}

/** Guide ids of the user's live channels (trimmed), to filter the import. */
export function knownEpgChannelIds(): Set<string> {
  const rows = getDb()
    .prepare(`SELECT DISTINCT TRIM(epg_channel_id) AS id FROM live_streams
              WHERE epg_channel_id IS NOT NULL AND TRIM(epg_channel_id) <> ''`)
    .all() as { id: string }[]
  return new Set(rows.map((r) => r.id))
}

/**
 * Replace the whole guide atomically: readers see the old guide until commit.
 * Returns the number of programmes stored.
 */
export function replaceGuide(programmes: Iterable<GuideProgrammeRow>, fetchedAt: number): number {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO epg_programmes (epg_channel_id, start_secs, end_secs, title, description)
     VALUES (?, ?, ?, ?, ?)`
  )
  let n = 0
  db.transaction(() => {
    db.prepare('DELETE FROM epg_programmes').run()
    for (const p of programmes) {
      insert.run(p.channel, p.startSecs, p.endSecs, p.title, p.description)
      n++
    }
    db.prepare(`INSERT INTO epg_fts(epg_fts) VALUES ('rebuild')`).run()
    db.prepare(
      `INSERT INTO epg_meta (key, value) VALUES ('fetched_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(fetchedAt))
  })()
  return n
}

/** When the local guide was downloaded (epoch ms), or null if never. */
export function guideFetchedAt(): number | null {
  const r = getDb().prepare(`SELECT value FROM epg_meta WHERE key = 'fetched_at'`).get() as
    | { value: string }
    | undefined
  const v = r ? Number(r.value) : NaN
  return Number.isFinite(v) ? v : null
}

/** Programmes not yet ended in the local guide. */
export function upcomingCount(nowSecs: number): number {
  return (
    getDb().prepare('SELECT COUNT(*) AS n FROM epg_programmes WHERE end_secs > ?').get(nowSecs) as {
      n: number
    }
  ).n
}

/**
 * Programmes on air or upcoming whose title/description match `query`, in
 * start order, each with the user's channels carrying it.
 */
export function searchGuide(
  query: string,
  nowSecs: number,
  limit: number
): { hits: GuideSearchHit[]; truncated: boolean } {
  const match = toFtsQuery(query)
  if (!match) return { hits: [], truncated: false }
  const db = getDb()
  const programmes = db
    .prepare(
      `SELECT p.id, p.epg_channel_id, p.start_secs, p.end_secs, p.title, p.description
       FROM epg_fts f JOIN epg_programmes p ON p.id = f.rowid
       WHERE epg_fts MATCH ? AND p.end_secs > ?
       ORDER BY p.start_secs, p.title
       LIMIT ?`
    )
    .all(match, nowSecs, limit + 1) as {
    id: number
    epg_channel_id: string
    start_secs: number
    end_secs: number
    title: string
    description: string | null
  }[]
  const truncated = programmes.length > limit
  const page = programmes.slice(0, limit)

  const channelsFor = db.prepare(
    `SELECT * FROM live_streams WHERE TRIM(epg_channel_id) = ?
     ORDER BY number IS NULL, number, name COLLATE NOCASE`
  )
  const cache = new Map<string, ChannelRow[]>()
  const hits: GuideSearchHit[] = []
  for (const p of page) {
    let rows = cache.get(p.epg_channel_id)
    if (!rows) {
      rows = channelsFor.all(p.epg_channel_id) as ChannelRow[]
      cache.set(p.epg_channel_id, rows)
    }
    if (rows.length === 0) continue
    hits.push({
      title: p.title,
      description: p.description,
      startSecs: p.start_secs,
      endSecs: p.end_secs,
      channels: rows.map(mapChannel)
    })
  }
  return { hits, truncated }
}
