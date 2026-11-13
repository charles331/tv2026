/**
 * Watch-progress store: where each movie / episode was stopped, what was
 * watched, and the recently watched live channels. Loaded once at the app root
 * and refreshed when the main process says a row changed (playback stopped, a
 * channel was started), so posters, detail pages and "Reprendre" stay in sync.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { resumeStart } from '@shared/index'
import type { ProgressKind, SetWatchedRequest, WatchProgress } from '@shared/index'
import { api, describeError, unwrap } from './ipc'

/** Synthetic category ids of the sidebar entries fed by this store. */
export const CONTINUE_CATEGORY_ID = '__continue__'
export const RECENT_CATEGORY_ID = '__recent__'

interface ProgressContextValue {
  /** Progress of one item, if it was ever played. */
  get: (kind: ProgressKind, itemId: number) => WatchProgress | undefined
  /** Started but not finished, most recent first ("Reprendre"). */
  inProgress: (kind: 'movie' | 'series') => WatchProgress[]
  /** Recently watched live channels, most recent first. */
  recentChannels: WatchProgress[]
  /** Forget an item's progress. */
  clear: (kind: ProgressKind, itemId: number) => Promise<void>
  /** Mark an item watched / not watched by hand. */
  setWatched: (req: SetWatchedRequest) => Promise<void>
}

const ProgressContext = createContext<ProgressContextValue | null>(null)
const keyOf = (kind: ProgressKind, itemId: number): string => `${kind}:${itemId}`

export function ProgressProvider({ children }: { children: ReactNode }): ReactElement {
  const [rows, setRows] = useState<WatchProgress[]>([])

  const reload = useCallback(async () => {
    try {
      setRows(unwrap(await api().progress.list()))
    } catch (e) {
      console.warn('progress.list a échoué :', describeError(e))
    }
  }, [])

  useEffect(() => {
    void reload()
    return api().progress.onChanged(() => void reload())
  }, [reload])

  const byKey = useMemo(() => new Map(rows.map((r) => [keyOf(r.kind, r.itemId), r])), [rows])

  const value = useMemo<ProgressContextValue>(
    () => ({
      get: (kind, itemId) => byKey.get(keyOf(kind, itemId)),
      inProgress: (kind) => rows.filter((r) => r.kind === kind && resumeStart(r) != null),
      recentChannels: rows.filter((r) => r.kind === 'live'),
      clear: async (kind, itemId) => {
        try {
          unwrap(await api().progress.clear(kind, itemId))
        } catch (e) {
          console.warn('progress.clear a échoué :', describeError(e))
        }
        await reload()
      },
      setWatched: async (req) => {
        try {
          unwrap(await api().progress.setWatched(req))
        } catch (e) {
          console.warn('progress.setWatched a échoué :', describeError(e))
        }
        await reload()
      }
    }),
    [byKey, rows, reload]
  )

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress must be used within a ProgressProvider')
  return ctx
}
