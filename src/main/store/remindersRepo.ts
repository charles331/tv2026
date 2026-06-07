/**
 * Typed repository for the `programme_reminders` table (live-TV reminders &
 * scheduled recordings). Mirrors favoritesRepo: pure CRUD over the SQLite store,
 * returning the clean shared `Reminder` type.
 *
 * Natural-key dedupe is enforced by a UNIQUE index on
 * `(stream_id, start_secs, title)`; addReminder() upserts on that key so a
 * second "Rappel" on the same programme just refreshes its snapshot/mode.
 */

import type {
  AddReminderRequest,
  Reminder,
  ReminderMode,
  ReminderStatus
} from '@shared/index'
import { getDb } from './db'

interface ReminderRow {
  id: number
  stream_id: number
  channel_name: string
  channel_icon: string | null
  epg_id: string | null
  title: string
  description: string | null
  start_secs: number
  end_secs: number
  lead_secs: number
  mode: ReminderMode
  status: ReminderStatus
  file_path: string | null
  created_at: number
  updated_at: number
}

function mapRow(r: ReminderRow): Reminder {
  return {
    id: r.id,
    streamId: r.stream_id,
    channelName: r.channel_name,
    channelIcon: r.channel_icon,
    epgId: r.epg_id,
    title: r.title,
    description: r.description,
    startSecs: r.start_secs,
    endSecs: r.end_secs,
    leadSecs: r.lead_secs,
    mode: r.mode,
    status: r.status,
    filePath: r.file_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/**
 * Insert (or refresh on the natural key) a reminder. `leadSecs` is resolved by
 * the caller (handler) from Settings; a fresh row starts `scheduled`. Returns
 * the persisted row. Re-adding an existing programme keeps its id/status and
 * just updates the snapshot + mode + lead.
 */
export function addReminder(req: AddReminderRequest & { leadSecs: number }): Reminder {
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO programme_reminders
       (stream_id, channel_name, channel_icon, epg_id, title, description,
        start_secs, end_secs, lead_secs, mode, status, file_path, created_at, updated_at)
     VALUES
       (@streamId, @channelName, @channelIcon, @epgId, @title, @description,
        @startSecs, @endSecs, @leadSecs, @mode, 'scheduled', NULL, @now, @now)
     ON CONFLICT(stream_id, start_secs, title) DO UPDATE SET
       channel_name = excluded.channel_name,
       channel_icon = excluded.channel_icon,
       epg_id       = excluded.epg_id,
       description  = excluded.description,
       end_secs     = excluded.end_secs,
       lead_secs    = excluded.lead_secs,
       mode         = excluded.mode,
       updated_at   = excluded.updated_at`
  ).run({
    streamId: req.streamId,
    channelName: req.channelName,
    channelIcon: req.channelIcon ?? null,
    epgId: req.epgId ?? null,
    title: req.title,
    description: req.description ?? null,
    startSecs: req.startSecs,
    endSecs: req.endSecs,
    leadSecs: req.leadSecs,
    mode: req.mode,
    now
  })
  const row = db
    .prepare(
      'SELECT * FROM programme_reminders WHERE stream_id = ? AND start_secs = ? AND title = ?'
    )
    .get(req.streamId, req.startSecs, req.title) as ReminderRow
  return mapRow(row)
}

/** Get one reminder by id, or null. */
export function getReminder(id: number): Reminder | null {
  const row = getDb().prepare('SELECT * FROM programme_reminders WHERE id = ?').get(id) as
    | ReminderRow
    | undefined
  return row ? mapRow(row) : null
}

/** All reminders, latest start first (newest programmes on top). */
export function listReminders(): Reminder[] {
  const rows = getDb()
    .prepare('SELECT * FROM programme_reminders ORDER BY start_secs DESC')
    .all() as ReminderRow[]
  return rows.map(mapRow)
}

/**
 * "Active" reminders the scheduler must track: not in a terminal state. Sorted
 * by start so the scheduler processes them in order.
 *
 * `conflict` is INCLUDED: a recording that hit a playback conflict is retried on
 * later ticks (it can still record once playback frees the connection, until its
 * window passes — the scheduler then terminalizes it to `missed`).
 */
export function listActiveReminders(): Reminder[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM programme_reminders
       WHERE status IN ('scheduled', 'notified', 'recording', 'conflict')
       ORDER BY start_secs ASC`
    )
    .all() as ReminderRow[]
  return rows.map(mapRow)
}

/** Patch a subset of fields. Always bumps updated_at. Returns the updated row. */
export function updateReminder(
  id: number,
  patch: {
    mode?: ReminderMode
    leadSecs?: number
    status?: ReminderStatus
    filePath?: string | null
  }
): Reminder | null {
  const existing = getReminder(id)
  if (!existing) return null
  const merged = {
    mode: patch.mode ?? existing.mode,
    leadSecs: patch.leadSecs ?? existing.leadSecs,
    status: patch.status ?? existing.status,
    filePath: patch.filePath === undefined ? existing.filePath : patch.filePath,
    now: Date.now(),
    id
  }
  const row = getDb()
    .prepare(
      `UPDATE programme_reminders
       SET mode = @mode, lead_secs = @leadSecs, status = @status,
           file_path = @filePath, updated_at = @now
       WHERE id = @id
       RETURNING *`
    )
    .get(merged) as ReminderRow | undefined
  return row ? mapRow(row) : null
}

/** Mark a reminder canceled (kept for history). Returns the updated row. */
export function cancelReminder(id: number): Reminder | null {
  return updateReminder(id, { status: 'canceled' })
}
