/**
 * Typed repository for download_queue + download_history.
 * download-engineer drives state transitions through these functions.
 */

import type { DownloadItem, DownloadKind, DownloadStatus } from '@shared/index'
import { getDb } from './db'

interface QueueRow {
  id: number
  stream_id: number
  kind: DownloadKind
  name: string
  file_name: string
  dest_path: string
  container_extension: string
  status: DownloadStatus
  total_bytes: number | null
  received_bytes: number
  queue_position: number
  error: string | null
  created_at: number
  updated_at: number
}

function mapItem(r: QueueRow): DownloadItem {
  const progress =
    r.total_bytes && r.total_bytes > 0
      ? Math.min(1, r.received_bytes / r.total_bytes)
      : null
  return {
    id: r.id,
    streamId: r.stream_id,
    kind: r.kind ?? 'movie',
    name: r.name,
    fileName: r.file_name,
    destPath: r.dest_path,
    containerExtension: r.container_extension,
    status: r.status,
    totalBytes: r.total_bytes,
    receivedBytes: r.received_bytes,
    progress,
    queuePosition: r.queue_position,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export interface NewDownload {
  streamId: number
  kind: DownloadKind
  name: string
  fileName: string
  destPath: string
  containerExtension: string
}

export function addDownload(d: NewDownload): DownloadItem {
  const db = getDb()
  // Dedupe: if an active (queued/downloading/paused) or still-listed completed
  // download for the same stream + kind already exists, return it instead of
  // enqueuing a duplicate — avoids two queue rows / two .part files for one
  // stream (e.g. a per-episode click racing a "download the whole season" run).
  // 'failed'/'canceled' rows are intentionally NOT matched, so they stay re-addable.
  const existing = db
    .prepare(
      `SELECT id FROM download_queue
       WHERE stream_id = ? AND kind = ?
         AND status IN ('queued','downloading','paused','completed')
       ORDER BY id ASC LIMIT 1`
    )
    .get(d.streamId, d.kind) as { id: number } | undefined
  if (existing) return getDownload(existing.id)!

  const now = Date.now()
  const nextPos =
    ((db.prepare('SELECT MAX(queue_position) AS m FROM download_queue').get() as {
      m: number | null
    }).m ?? 0) + 1
  const info = db
    .prepare(
      `INSERT INTO download_queue
         (stream_id, kind, name, file_name, dest_path, container_extension, status,
          received_bytes, queue_position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`
    )
    .run(d.streamId, d.kind, d.name, d.fileName, d.destPath, d.containerExtension, nextPos, now, now)
  return getDownload(Number(info.lastInsertRowid))!
}

export function getDownload(id: number): DownloadItem | null {
  const row = getDb()
    .prepare('SELECT * FROM download_queue WHERE id = ?')
    .get(id) as QueueRow | undefined
  return row ? mapItem(row) : null
}

export function listDownloads(): DownloadItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM download_queue ORDER BY queue_position ASC, id ASC')
    .all() as QueueRow[]
  return rows.map(mapItem)
}

export function updateStatus(id: number, status: DownloadStatus, error?: string | null): void {
  getDb()
    .prepare('UPDATE download_queue SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(status, error ?? null, Date.now(), id)
}

export function updateProgress(id: number, receivedBytes: number, totalBytes: number | null): void {
  getDb()
    .prepare(
      'UPDATE download_queue SET received_bytes = ?, total_bytes = ?, updated_at = ? WHERE id = ?'
    )
    .run(receivedBytes, totalBytes, Date.now(), id)
}

export function reorder(orderedIds: number[]): DownloadItem[] {
  const db = getDb()
  const stmt = db.prepare('UPDATE download_queue SET queue_position = ?, updated_at = ? WHERE id = ?')
  const now = Date.now()
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, idx) => stmt.run(idx + 1, now, id))
  })
  tx(orderedIds)
  return listDownloads()
}

/** Move a completed/canceled item into history and remove it from the queue. */
export function archiveToHistory(id: number, finalStatus: 'completed' | 'canceled'): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM download_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined
    if (!row) return
    db.prepare(
      `INSERT INTO download_history
         (stream_id, kind, name, file_name, dest_path, total_bytes, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.stream_id,
      row.kind ?? 'movie',
      row.name,
      row.file_name,
      row.dest_path,
      row.total_bytes,
      finalStatus,
      Date.now()
    )
    db.prepare('DELETE FROM download_queue WHERE id = ?').run(id)
  })
  tx()
}

/** Remove completed/canceled/failed items from the queue. Returns count removed. */
export function clearFinished(): number {
  const info = getDb()
    .prepare(`DELETE FROM download_queue WHERE status IN ('completed','canceled','failed')`)
    .run()
  return info.changes
}

/** True if a completed download exists in history for the given stream + kind. */
export function isDownloaded(streamId: number, kind: DownloadKind = 'movie'): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM download_history
       WHERE stream_id = ? AND kind = ? AND status = 'completed' LIMIT 1`
    )
    .get(streamId, kind)
  return Boolean(row)
}

/**
 * Return the recorded destination path of a completed download for this stream,
 * or null if none. Checks both the active queue (status 'completed') and the
 * history table; the most recently completed wins. Does NOT verify the file
 * exists on disk — the caller (handler) does that check.
 */
export function getCompletedPath(streamId: number, kind: DownloadKind = 'movie'): string | null {
  const row = getDb()
    .prepare(
      `SELECT dest_path FROM (
         SELECT dest_path, updated_at AS ts FROM download_queue
           WHERE stream_id = ? AND kind = ? AND status = 'completed'
         UNION ALL
         SELECT dest_path, completed_at AS ts FROM download_history
           WHERE stream_id = ? AND kind = ? AND status = 'completed'
       )
       ORDER BY ts DESC
       LIMIT 1`
    )
    .get(streamId, kind, streamId, kind) as { dest_path: string } | undefined
  return row?.dest_path ?? null
}

/**
 * All stream ids that have a completed download recorded — across the active
 * queue (status 'completed') AND the archived history. This is the persistent
 * source of truth for "already downloaded?", surviving app restarts and the
 * archiving that removes finished items from the queue. The set is kind-agnostic
 * (movie stream ids and series episode ids share the renderer's "downloaded"
 * set, mirroring the queue-derived behaviour).
 */
export function listCompletedStreamIds(): number[] {
  const rows = getDb()
    .prepare(
      `SELECT stream_id FROM download_queue WHERE status = 'completed'
       UNION
       SELECT stream_id FROM download_history WHERE status = 'completed'`
    )
    .all() as { stream_id: number }[]
  return rows.map((r) => r.stream_id)
}

/**
 * On startup, downloads left in 'downloading' from a previous run can't still
 * be active — reset them to 'paused' so the engine can resume cleanly.
 */
export function reconcileOnStartup(): void {
  getDb()
    .prepare(`UPDATE download_queue SET status = 'paused', updated_at = ? WHERE status = 'downloading'`)
    .run(Date.now())
}
