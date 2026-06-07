import { useEffect, useState, type ReactElement } from 'react'
import type { ConflictResolution, RecordingConflictEvent, Reminder } from '@shared/index'
import { api } from '../../lib/ipc'
import { Button } from '../../components/ui'

/**
 * Recording-vs-playback conflict dialog. Lives at the app root and listens for
 * `recording:conflict` from the main scheduler: a scheduled recording must start
 * while playback holds the single connection. The user chooses to keep playback
 * or switch to recording; the choice is sent back via recording:resolveConflict.
 * If the user does nothing, the main process times out (~30 s → keep playback).
 */
export function ConflictDialog(): ReactElement | null {
  const [reminder, setReminder] = useState<Reminder | null>(null)

  useEffect(() => {
    return api().reminders.onConflict((e: RecordingConflictEvent) => {
      setReminder(e.reminder)
    })
  }, [])

  if (!reminder) return null

  const decide = (resolution: ConflictResolution): void => {
    void api().reminders.resolveConflict({ reminderId: reminder.id, resolution })
    setReminder(null)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="fade-in w-full max-w-md rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Enregistrement programmé</h2>
        <p className="mt-2 text-sm text-gray-400">
          L’enregistrement de <strong className="text-gray-200">« {reminder.title} »</strong> (
          {reminder.channelName}) doit démarrer, mais une lecture est en cours et la connexion est
          unique. Que faire ?
        </p>
        <p className="mt-2 text-xs text-gray-600">
          Sans réponse, la lecture est conservée au bout de 30 s et l’enregistrement est ignoré.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => decide('keepPlayback')}>
            Continuer la lecture
          </Button>
          <Button variant="primary" onClick={() => decide('switchToRecording')}>
            Basculer sur l’enregistrement
          </Button>
        </div>
      </div>
    </div>
  )
}
