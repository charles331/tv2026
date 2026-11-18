/**
 * TV mode: a due reminder, shown inside the app (a Windows notification only
 * answers a mouse click, and the video covers the screen). The main process
 * brought the app in front of the video; "Ignorer" puts the video back.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Reminder } from '@shared/index'
import { api } from '../../lib/ipc'
import { Button } from '../../components/ui'
import { FocusZone, useBackHandler, useReturnFocus } from '../../lib/remote/focus'
import { formatClockFromEpochSecs } from '../../lib/format'

export function ReminderPrompt({
  onWatch
}: {
  onWatch: (reminder: Reminder) => void
}): ReactElement | null {
  const [queue, setQueue] = useState<Reminder[]>([])
  useEffect(
    () =>
      api().reminders.onPrompt(({ reminder }) =>
        setQueue((q) => (q.some((r) => r.id === reminder.id) ? q : [...q, reminder]))
      ),
    []
  )
  const current = queue[0]
  if (!current) return null
  const done = (): void => setQueue((q) => q.filter((r) => r.id !== current.id))
  return (
    <PromptCard
      key={current.id}
      reminder={current}
      onWatch={() => {
        done()
        onWatch(current)
      }}
      onIgnore={() => {
        done()
        void api().player.videoFront()
      }}
    />
  )
}

function PromptCard({
  reminder,
  onWatch,
  onIgnore
}: {
  reminder: Reminder
  onWatch: () => void
  onIgnore: () => void
}): ReactElement {
  useReturnFocus()
  useBackHandler(onIgnore)
  useEffect(() => {
    setFocus('reminder-prompt-watch')
  }, [])
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <FocusZone
        focusKey="reminder-prompt"
        boundary
        className="fade-in w-full max-w-md rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-white">Rappel</h2>
        <p className="mt-2 text-sm text-gray-300">
          <strong className="text-white">« {reminder.title} »</strong> commence sur{' '}
          {reminder.channelName} à {formatClockFromEpochSecs(reminder.startSecs)}.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onIgnore}>
            Ignorer
          </Button>
          <Button focusKey="reminder-prompt-watch" variant="primary" onClick={onWatch}>
            Regarder
          </Button>
        </div>
      </FocusZone>
    </div>
  )
}
