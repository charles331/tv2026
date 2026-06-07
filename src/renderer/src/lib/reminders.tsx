/**
 * Reminders store. Holds the user's programme reminders & scheduled recordings,
 * merges in live `reminder:updated` events from the main scheduler, and exposes
 * add/cancel/update helpers. Provided once at the app root so the guide buttons,
 * the "Programmés" view and the conflict dialog share one source of truth.
 *
 * Template: lib/favorites.tsx (context provider) + lib/downloads.tsx (events).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import type {
  AddReminderRequest,
  Reminder,
  ReminderUpdatedEvent,
  UpdateReminderRequest
} from '@shared/index'
import { api, describeError, unwrap } from './ipc'

interface RemindersContextValue {
  reminders: Reminder[]
  loading: boolean
  /** Whether a reminder exists for this exact programme (natural key). */
  has: (streamId: number, startSecs: number, title: string) => Reminder | undefined
  add: (req: AddReminderRequest) => Promise<Reminder | null>
  cancel: (id: number) => Promise<void>
  update: (req: UpdateReminderRequest) => Promise<void>
  reload: () => Promise<void>
}

const RemindersContext = createContext<RemindersContextValue | null>(null)

export function RemindersProvider({ children }: { children: ReactNode }): ReactElement {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setReminders(unwrap(await api().reminders.list()))
    } catch (e) {
      console.warn('reminders.list a échoué :', describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Merge live status/filePath changes pushed by the main scheduler.
  useEffect(() => {
    return api().reminders.onUpdated((e: ReminderUpdatedEvent) => {
      setReminders((prev) => {
        const without = prev.filter((r) => r.id !== e.reminder.id)
        return [e.reminder, ...without]
      })
    })
  }, [])

  const has = useCallback(
    (streamId: number, startSecs: number, title: string) =>
      reminders.find(
        (r) =>
          r.streamId === streamId &&
          r.startSecs === startSecs &&
          r.title === title &&
          r.status !== 'canceled'
      ),
    [reminders]
  )

  const add = useCallback(async (req: AddReminderRequest) => {
    try {
      const r = unwrap(await api().reminders.add(req))
      setReminders((prev) => [r, ...prev.filter((p) => p.id !== r.id)])
      return r
    } catch (e) {
      console.warn('reminders.add a échoué :', describeError(e))
      return null
    }
  }, [])

  const cancel = useCallback(async (id: number) => {
    try {
      const r = unwrap(await api().reminders.cancel(id))
      setReminders((prev) => prev.map((p) => (p.id === r.id ? r : p)))
    } catch (e) {
      console.warn('reminders.cancel a échoué :', describeError(e))
    }
  }, [])

  const update = useCallback(async (req: UpdateReminderRequest) => {
    try {
      const r = unwrap(await api().reminders.update(req))
      setReminders((prev) => prev.map((p) => (p.id === r.id ? r : p)))
    } catch (e) {
      console.warn('reminders.update a échoué :', describeError(e))
    }
  }, [])

  return (
    <RemindersContext.Provider
      value={{ reminders, loading, has, add, cancel, update, reload }}
    >
      {children}
    </RemindersContext.Provider>
  )
}

export function useReminders(): RemindersContextValue {
  const ctx = useContext(RemindersContext)
  if (!ctx) throw new Error('useReminders must be used within a RemindersProvider')
  return ctx
}
