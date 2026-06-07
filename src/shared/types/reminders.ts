/**
 * Programme reminders & scheduled recordings — domain types.
 *
 * A reminder pins a single live-TV programme (identified by the natural key
 * `(streamId, startSecs, title)` since provider EPG ids are unstable). It can
 * just notify (`notify`), record (`record`) or both (`notify_record`). The main
 * process scheduler fires a native notification at `start − lead` and, for
 * recording modes, drives a headless mpv dump from `start − padBefore` to
 * `end + padAfter`.
 *
 * Reminders/recordings only run while the app is open (background mode is a
 * later étape).
 */

/** What a reminder does when its programme is due. */
export type ReminderMode = 'notify' | 'record' | 'notify_record'

/**
 * Lifecycle status of a reminder/recording.
 *  - scheduled : pending, in the future
 *  - notified  : the lead-time notification has fired (anti-duplicate)
 *  - recording : a headless dump is in progress
 *  - completed : recording finished OK
 *  - missed    : start passed while the app was closed (never fired)
 *  - failed    : recording could not start / errored
 *  - canceled  : the user canceled it
 *  - conflict  : recording could not run because playback held the connection
 */
export type ReminderStatus =
  | 'scheduled'
  | 'notified'
  | 'recording'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'canceled'
  | 'conflict'

/** A persisted reminder/recording row (snapshot for offline display). */
export interface Reminder {
  id: number
  streamId: number
  /** Snapshot of the channel name for display. */
  channelName: string
  /** Snapshot of the channel logo URL. */
  channelIcon: string | null
  /** Provider EPG id if present (not relied upon — see natural key). */
  epgId: string | null
  /** Snapshot of the programme title. */
  title: string
  /** Snapshot of the programme description. */
  description: string | null
  /** Programme start, Unix epoch seconds. */
  startSecs: number
  /** Programme end, Unix epoch seconds. */
  endSecs: number
  /** Notify this many seconds BEFORE the start. */
  leadSecs: number
  mode: ReminderMode
  status: ReminderStatus
  /** Absolute path of the recording file once it exists. */
  filePath: string | null
  createdAt: number
  updatedAt: number
}

/** Create a reminder/recording for a programme. */
export interface AddReminderRequest {
  streamId: number
  channelName: string
  channelIcon?: string | null
  epgId?: string | null
  title: string
  description?: string | null
  startSecs: number
  endSecs: number
  mode: ReminderMode
  /** Override the default lead; omitted = use the user's Settings default. */
  leadSecs?: number
}

/** Patch a subset of a reminder (mode/lead from the UI; status from main). */
export interface UpdateReminderRequest {
  id: number
  mode?: ReminderMode
  leadSecs?: number
  status?: ReminderStatus
}

/** Event payload: a reminder row changed (status/filePath) in the main process. */
export interface ReminderUpdatedEvent {
  reminder: Reminder
}

/** Event payload: a reminder notification was clicked → open the channel. */
export interface ReminderOpenChannelEvent {
  streamId: number
  channelName: string
}

/**
 * Event payload: a scheduled recording must start but playback holds the single
 * connection. The renderer shows a dialog and replies via recording:resolveConflict.
 */
export interface RecordingConflictEvent {
  reminder: Reminder
}

/** The user's decision when a recording conflicts with current playback. */
export type ConflictResolution = 'keepPlayback' | 'switchToRecording'

/** Reply to a recording conflict prompt. */
export interface ResolveConflictRequest {
  reminderId: number
  resolution: ConflictResolution
}
