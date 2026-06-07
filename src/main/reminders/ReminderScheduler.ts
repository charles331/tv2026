/**
 * ReminderScheduler — main-process singleton that drives programme reminders &
 * scheduled recordings while the app is open.
 *
 * Responsibilities (the time/decision math lives in PURE schedulerLogic.ts):
 *  - tick every ~20 s (and once on startup) over the active reminders,
 *  - fire native notifications at start − lead (anti-duplicate via status),
 *  - mark reminders missed when their start passed while the app was closed,
 *  - start/stop headless recordings via RecordingController with padding,
 *  - resolve the recording-vs-playback conflict by ASKING the user over IPC
 *    (recording:conflict → recording:resolveConflict; ~30 s timeout = keep
 *    playback + mark conflict),
 *  - emit reminder:updated so the renderer "Programmés" view refreshes,
 *  - on a clicked notification, focus the window + emit reminder:openChannel.
 *
 * Reminders/recordings only run while the app is open (background = later étape).
 */

import { join } from 'path'
import { app, Notification, type BrowserWindow } from 'electron'

import type { ConflictResolution, EventContract, Reminder } from '@shared/index'
import { EventChannels } from '@shared/index'

import { remindersRepo, settingsRepo } from '../store'
import { downloadSubfolder } from '../downloads/helpers'
import { assertPathWithin } from '../ipc/validate'
import { playerController } from '../player/PlayerController'
import { recordingController, RecordingError } from '../player/RecordingController'
import { computeDueActions } from './schedulerLogic'

/** Typed emitter shape (matches makeEmitter() in ipc/register.ts). */
type Emitter = <C extends keyof EventContract>(channel: C, payload: EventContract[C]) => void

/** Tick cadence — the spec asks for ~20–30 s. */
const TICK_MS = 20_000
/** How long we wait for the user to resolve a conflict before defaulting. */
const CONFLICT_TIMEOUT_MS = 30_000

/** Sanitize a filename for Windows (mirrors the interactive recording handler). */
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned || 'Enregistrement'
}

/** Filesystem-safe local timestamp: "2026-06-03 14-30-05". */
function recordingTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  )
}

export class ReminderScheduler {
  private emit: Emitter = () => {}
  private getWindows: () => BrowserWindow[] = () => []
  private timer: NodeJS.Timeout | null = null
  /** Re-entrancy guard: a tick may run long (a recording start), and setInterval
   *  fires regardless — never run two ticks concurrently. */
  private ticking = false
  /** Reminder ids currently awaiting a conflict decision (avoid re-asking). */
  private readonly awaitingConflict = new Set<number>()
  /** Pending conflict resolvers keyed by reminder id. */
  private readonly conflictResolvers = new Map<
    number,
    { resolve: (r: ConflictResolution) => void; timeout: NodeJS.Timeout }
  >()

  /** Wire the typed emitter + window accessor (called once from main/index.ts). */
  attach(emit: Emitter, getWindows: () => BrowserWindow[]): void {
    this.emit = emit
    this.getWindows = getWindows
  }

  /** Start the periodic tick + run once immediately (handles startup/missed). */
  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  /** Run a tick now (e.g. just after a reminder was added for an imminent show). */
  kick(): void {
    void this.tick()
  }

  /** Stop ticking and tear down any in-progress recording (shutdown). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const { timeout } of this.conflictResolvers.values()) clearTimeout(timeout)
    this.conflictResolvers.clear()
    this.awaitingConflict.clear()
    recordingController.disposeForShutdown()
  }

  /** Renderer's reply to a conflict prompt. Returns true if it matched a pending ask. */
  resolveConflict(reminderId: number, resolution: ConflictResolution): boolean {
    const pending = this.conflictResolvers.get(reminderId)
    if (!pending) return false
    clearTimeout(pending.timeout)
    this.conflictResolvers.delete(reminderId)
    pending.resolve(resolution)
    return true
  }

  /**
   * Drop any pending conflict prompt for a reminder (called when it's canceled
   * mid-prompt). Settling the promise lets handleConflict() unwind; it re-reads
   * the row and bails because the status is no longer restartable, so a canceled
   * reminder is never resurrected to `conflict`.
   */
  cancelConflict(reminderId: number): void {
    const pending = this.conflictResolvers.get(reminderId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.conflictResolvers.delete(reminderId)
    pending.resolve('keepPlayback')
  }

  // ------------------------------------------------------------------ tick

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      let reminders: Reminder[]
      try {
        reminders = remindersRepo.listActiveReminders()
      } catch (e) {
        console.error('[ReminderScheduler] listActiveReminders failed', e)
        return
      }
      if (reminders.length === 0) return

      const settings = settingsRepo.getSettings()
      const nowSecs = Math.floor(Date.now() / 1000)
      const actions = computeDueActions(
        reminders,
        nowSecs,
        settings.recordPadBeforeSecs,
        settings.recordPadAfterSecs
      )

      for (const r of actions.missed) this.markStatus(r.id, 'missed')
      for (const r of actions.toNotify) this.fireNotification(r)
      for (const r of actions.toStopRecording) this.stopRecording(r)
      // Recordings last so a notify_record reminder gets its notification first.
      for (const r of actions.toStartRecording) await this.beginRecording(r)
    } finally {
      this.ticking = false
    }
  }

  // ------------------------------------------------------------ notifications

  private fireNotification(r: Reminder): void {
    if (!Notification.isSupported()) {
      // No native notifications on this OS — still advance status so we don't
      // re-evaluate the same reminder forever.
      this.markStatus(r.id, 'notified')
      return
    }
    try {
      const n = new Notification({
        title: `Bientôt : ${r.title}`,
        body: `${r.channelName} — ${formatClock(r.startSecs)}`
      })
      n.on('click', () => {
        this.focusWindow()
        this.emit(EventChannels.REMINDER_OPEN_CHANNEL, {
          streamId: r.streamId,
          channelName: r.channelName
        })
      })
      n.show()
    } catch (e) {
      console.error('[ReminderScheduler] notification failed', e)
    }
    // Mark notified regardless so we never double-notify (anti-duplicate).
    this.markStatus(r.id, 'notified')
  }

  // -------------------------------------------------------------- recording

  /** Begin a scheduled recording, resolving a playback conflict first if needed. */
  private async beginRecording(r: Reminder): Promise<void> {
    if (recordingController.isRecording()) {
      // Another recording overlaps → conflict (retried on a later tick once it
      // frees up, or marked missed when this one's window ends).
      if (recordingController.currentReminderId() !== r.id) this.markStatus(r.id, 'conflict')
      return
    }
    if (this.awaitingConflict.has(r.id)) return // a prompt is already pending

    if (this.isPlaybackHoldingConnection()) {
      // Already answered "keep playback" (or timed out) earlier → don't nag every
      // tick. It will start by itself once playback frees the connection, or be
      // marked missed when its record window ends.
      if (r.status === 'conflict') return
      // First time the record window meets active playback → ASK, WITHOUT
      // blocking the tick (awaitingConflict prevents re-asking meanwhile).
      void this.handleConflict(r)
      return
    }

    await this.startRecordingNow(r)
  }

  /**
   * Resolve a recording-vs-playback conflict out-of-band so the tick is never
   * blocked for up to 30 s. Holds `awaitingConflict` for its whole life (so
   * concurrent ticks skip this reminder), RE-READS the row after the answer (it
   * may have been canceled while prompting — never resurrect it), and always
   * emits RECORDING_CONFLICT_RESOLVED so the renderer dismisses its dialog.
   */
  private async handleConflict(r: Reminder): Promise<void> {
    this.awaitingConflict.add(r.id)
    try {
      const resolution = await this.askConflict(r)
      const fresh = remindersRepo.getReminder(r.id)
      if (!fresh || !isRestartableStatus(fresh.status)) return
      if (resolution === 'keepPlayback') {
        this.markStatus(r.id, 'conflict')
        this.notifyConflictKept(r)
        return
      }
      // switchToRecording: free the connection by stopping playback, unless a
      // recording started in the meantime.
      if (recordingController.isRecording()) {
        this.markStatus(r.id, 'conflict')
        return
      }
      await playerController.stop().catch(() => undefined)
      await this.startRecordingNow(r)
    } finally {
      this.awaitingConflict.delete(r.id)
      this.emit(EventChannels.RECORDING_CONFLICT_RESOLVED, { reminderId: r.id })
    }
  }

  private async startRecordingNow(r: Reminder): Promise<void> {
    const settings = settingsRepo.getSettings()
    if (!settings.downloadDir) {
      this.markStatus(r.id, 'failed')
      return
    }
    let filePath: string
    try {
      const base = sanitizeFileName(`${r.channelName} - ${r.title}`)
      const liveDir = join(settings.downloadDir, downloadSubfolder('live'))
      filePath = assertPathWithin(
        join(liveDir, `${base} ${recordingTimestamp()}.ts`),
        settings.downloadDir
      )
    } catch {
      this.markStatus(r.id, 'failed')
      return
    }

    // Mark 'recording' BEFORE spawning so the onExit handler (which may fire
    // immediately on a fast crash) reliably sees the in-progress state.
    this.markStatus(r.id, 'recording', filePath)
    try {
      await recordingController.start({
        reminderId: r.id,
        streamId: r.streamId,
        ext: 'ts',
        filePath,
        onExit: () => {
          // The recorder stops by being killed at end+padAfter (stopRecording)
          // or by a crash. If we deliberately stopped it, status is already
          // 'completed'; otherwise finalize it here (the partial file is kept).
          const fresh = remindersRepo.getReminder(r.id)
          if (fresh && fresh.status === 'recording') {
            this.markStatus(r.id, 'completed', filePath)
          }
        }
      })
    } catch (e) {
      const msg = e instanceof RecordingError ? e.message : String(e)
      console.error('[ReminderScheduler] recording start failed', msg)
      this.markStatus(r.id, 'failed')
    }
  }

  private stopRecording(r: Reminder): void {
    // Mark completed first so the onExit handler doesn't double-transition.
    const updated = remindersRepo.updateReminder(r.id, { status: 'completed' })
    if (updated) this.emit(EventChannels.REMINDER_UPDATED, { reminder: updated })
    recordingController.stop(r.id)
  }

  // --------------------------------------------------------------- conflict

  /** Whether live/stream playback currently holds the single connection. */
  private isPlaybackHoldingConnection(): boolean {
    const status = playerController.getStatus()
    return status.source === 'stream' && status.state !== 'idle' && status.state !== 'ended'
  }

  /**
   * ASK the renderer to resolve the conflict; resolve with the user's choice or
   * default to 'keepPlayback' after CONFLICT_TIMEOUT_MS.
   */
  private askConflict(r: Reminder): Promise<ConflictResolution> {
    this.emit(EventChannels.RECORDING_CONFLICT, { reminder: r })
    return new Promise<ConflictResolution>((resolve) => {
      const timeout = setTimeout(() => {
        this.conflictResolvers.delete(r.id)
        resolve('keepPlayback')
      }, CONFLICT_TIMEOUT_MS)
      this.conflictResolvers.set(r.id, {
        resolve: (res) => resolve(res),
        timeout
      })
    })
  }

  private notifyConflictKept(r: Reminder): void {
    if (!Notification.isSupported()) return
    try {
      new Notification({
        title: 'Enregistrement non démarré',
        body: `« ${r.title} » : lecture en cours conservée. L’enregistrement a été ignoré.`
      }).show()
    } catch {
      // best-effort
    }
  }

  // ----------------------------------------------------------------- helpers

  private markStatus(id: number, status: Reminder['status'], filePath?: string): void {
    const updated = remindersRepo.updateReminder(id, {
      status,
      ...(filePath !== undefined ? { filePath } : {})
    })
    if (updated) this.emit(EventChannels.REMINDER_UPDATED, { reminder: updated })
  }

  private focusWindow(): void {
    const win = this.getWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    app.focus({ steal: true })
  }
}

/** Statuses from which a recording may still (re)start. */
function isRestartableStatus(s: Reminder['status']): boolean {
  return s === 'scheduled' || s === 'notified' || s === 'conflict'
}

/** Format an epoch (seconds) as a short local time, e.g. "20:00". */
function formatClock(secs: number): string {
  try {
    return new Date(secs * 1000).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

/** Singleton shared across the main process. */
export const reminderScheduler = new ReminderScheduler()
