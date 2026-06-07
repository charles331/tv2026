/**
 * PURE scheduling logic for programme reminders — no timers, no OS, no DB.
 *
 * Everything here is deterministic given (reminders, nowSecs): which reminders
 * are due to notify, which recordings should start/stop, which were missed
 * while the app was closed, and what status transition each implies. The
 * ReminderScheduler singleton wires this to a tick + Notification + recorder.
 *
 * Keeping this isolated makes the tricky bits (lead/padding windows, missed
 * detection, conflict detection, dedupe of already-notified rows) unit-testable.
 *
 * Times are Unix epoch SECONDS throughout (matching the EPG / DB columns).
 */

import type { Reminder, ReminderMode } from '@shared/index'

/** True when the reminder's mode includes a native notification. */
export function isNotifyMode(mode: ReminderMode): boolean {
  return mode === 'notify' || mode === 'notify_record'
}

/** True when the reminder's mode includes a recording. */
export function isRecordMode(mode: ReminderMode): boolean {
  return mode === 'record' || mode === 'notify_record'
}

/** The instant a reminder's notification should fire (start − lead), in secs. */
export function notifyAtSecs(r: Pick<Reminder, 'startSecs' | 'leadSecs'>): number {
  return r.startSecs - r.leadSecs
}

/** The instant a recording should start (start − padBefore), in secs. */
export function recordStartSecs(
  r: Pick<Reminder, 'startSecs'>,
  padBeforeSecs: number
): number {
  return r.startSecs - padBeforeSecs
}

/** The instant a recording should stop (end + padAfter), in secs. */
export function recordStopSecs(r: Pick<Reminder, 'endSecs'>, padAfterSecs: number): number {
  return r.endSecs + padAfterSecs
}

/**
 * A reminder counts as "missed" when its programme START has already passed
 * (with a small grace window) and no notification/recording ever ran for it
 * (still `scheduled`). This is the "app was closed over the programme" case.
 *
 * We treat the START (not start−lead) as the cutoff: a notification a bit late
 * is still useful, but once the programme itself has begun, a pure-notify
 * reminder is moot. A grace window avoids flapping right at the boundary.
 */
export function isMissed(
  r: Pick<Reminder, 'status' | 'startSecs'>,
  nowSecs: number,
  graceSecs = 60
): boolean {
  return r.status === 'scheduled' && nowSecs > r.startSecs + graceSecs
}

/**
 * Whether a scheduled reminder is due to NOTIFY now: notify mode, still
 * `scheduled`, the notify instant has arrived, and the programme has not fully
 * ended yet (no point notifying for something already over — that's "missed").
 */
export function isNotifyDue(
  r: Pick<Reminder, 'status' | 'mode' | 'startSecs' | 'endSecs' | 'leadSecs'>,
  nowSecs: number
): boolean {
  if (r.status !== 'scheduled') return false
  if (!isNotifyMode(r.mode)) return false
  return nowSecs >= notifyAtSecs(r) && nowSecs < r.endSecs
}

/**
 * Whether a recording should be RUNNING now: record mode, within
 * [start−padBefore, end+padAfter), and not already in a terminal/recording
 * state. Used to decide "start this recording".
 */
export function isRecordDue(
  r: Pick<Reminder, 'status' | 'mode' | 'startSecs' | 'endSecs'>,
  nowSecs: number,
  padBeforeSecs: number,
  padAfterSecs: number
): boolean {
  if (!isRecordMode(r.mode)) return false
  // Only start from a pre-recording state; 'recording' is already handled.
  if (r.status !== 'scheduled' && r.status !== 'notified' && r.status !== 'conflict') {
    return false
  }
  const startAt = recordStartSecs(r, padBeforeSecs)
  const stopAt = recordStopSecs(r, padAfterSecs)
  return nowSecs >= startAt && nowSecs < stopAt
}

/**
 * Whether an in-progress recording should STOP now: it is `recording` and we
 * have reached end+padAfter.
 */
export function isRecordStopDue(
  r: Pick<Reminder, 'status' | 'endSecs'>,
  nowSecs: number,
  padAfterSecs: number
): boolean {
  return r.status === 'recording' && nowSecs >= recordStopSecs(r, padAfterSecs)
}

/** The concrete actions the scheduler should take for one tick. */
export interface DueActions {
  /** Notify-only reminders whose lead time arrived (transition → notified). */
  toNotify: Reminder[]
  /** Record-mode reminders that should begin recording now. */
  toStartRecording: Reminder[]
  /** Recordings that have reached end+padAfter and should stop. */
  toStopRecording: Reminder[]
  /** Reminders whose start passed while the app was closed (→ missed). */
  missed: Reminder[]
}

/**
 * Compute every due action for a tick. Pure: same inputs → same output.
 *
 * A `notify_record` reminder appears in BOTH toNotify (at lead) and
 * toStartRecording (at start−padBefore) as those windows are reached — the
 * caller transitions status accordingly.
 */
export function computeDueActions(
  reminders: readonly Reminder[],
  nowSecs: number,
  padBeforeSecs: number,
  padAfterSecs: number
): DueActions {
  const toNotify: Reminder[] = []
  const toStartRecording: Reminder[] = []
  const toStopRecording: Reminder[] = []
  const missed: Reminder[] = []

  for (const r of reminders) {
    if (isRecordStopDue(r, nowSecs, padAfterSecs)) {
      toStopRecording.push(r)
      continue
    }
    if (isMissed(r, nowSecs) && !isRecordDue(r, nowSecs, padBeforeSecs, padAfterSecs)) {
      missed.push(r)
      continue
    }
    if (isNotifyDue(r, nowSecs)) toNotify.push(r)
    if (isRecordDue(r, nowSecs, padBeforeSecs, padAfterSecs)) toStartRecording.push(r)
  }

  return { toNotify, toStartRecording, toStopRecording, missed }
}
