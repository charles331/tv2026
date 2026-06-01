/**
 * Live downloads store.
 *
 * Holds the authoritative list of {@link DownloadItem}s, merges in live
 * `onProgress` / `onState` events, and exposes action helpers. Provided once at
 * the app root so both the Downloads panel and the catalogue (for "déjà
 * téléchargé" badges) read the same source of truth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import type {
  AddDownloadRequest,
  DownloadItem,
  DownloadProgressEvent,
  DownloadStateEvent
} from '@shared/index'
import { api, describeError, unwrap } from './ipc'

interface DownloadsContextValue {
  items: DownloadItem[]
  loading: boolean
  error: string | null
  /** Stream ids that have a completed (or in-flight) download — for badges. */
  downloadedStreamIds: Set<number>
  add: (req: AddDownloadRequest) => Promise<DownloadItem>
  pause: (id: number) => Promise<void>
  resume: (id: number) => Promise<void>
  cancel: (id: number) => Promise<void>
  reorder: (orderedIds: number[]) => Promise<void>
  clearCompleted: () => Promise<void>
  reload: () => void
  /** Live speed/ETA for an item (not persisted on DownloadItem). */
  getLiveProgress: (id: number) => DownloadProgressEvent | undefined
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

const ACTIVE_STATUSES: ReadonlySet<DownloadItem['status']> = new Set([
  'queued',
  'downloading',
  'paused'
])

export function DownloadsProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<DownloadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = unwrap(await api().downloads.list())
      setItems(list)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Merge live progress ticks into the matching item.
  useEffect(() => {
    const offProgress = api().downloads.onProgress((e: DownloadProgressEvent) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === e.id
            ? {
                ...it,
                status: e.status,
                receivedBytes: e.receivedBytes,
                totalBytes: e.totalBytes,
                progress: e.progress
              }
            : it
        )
      )
    })
    const offState = api().downloads.onState((e: DownloadStateEvent) => {
      // A completion/failure can move items between queue/history; the safest
      // path for correctness is to optimistically patch then resync from main.
      setItems((prev) =>
        prev.map((it) =>
          it.id === e.id
            ? {
                ...it,
                status: e.status,
                error: e.error ?? it.error,
                destPath: e.destPath ?? it.destPath
              }
            : it
        )
      )
      if (e.status === 'completed' || e.status === 'failed' || e.status === 'canceled') {
        void refresh()
      }
    })
    return () => {
      offProgress()
      offState()
    }
  }, [refresh])

  // Live, instantaneous speed/eta is not part of DownloadItem; the panel reads
  // those from a separate progress cache so the list stays serializable.
  const progressCache = useRef<Map<number, DownloadProgressEvent>>(new Map())
  useEffect(() => {
    const off = api().downloads.onProgress((e) => {
      progressCache.current.set(e.id, e)
    })
    return off
  }, [])

  const add = useCallback(async (req: AddDownloadRequest) => {
    const item = unwrap(await api().downloads.add(req))
    setItems((prev) => {
      const without = prev.filter((it) => it.id !== item.id)
      return [...without, item]
    })
    return item
  }, [])

  const patchOne = useCallback((updated: DownloadItem) => {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
  }, [])

  const pause = useCallback(
    async (id: number) => patchOne(unwrap(await api().downloads.pause(id))),
    [patchOne]
  )
  const resume = useCallback(
    async (id: number) => patchOne(unwrap(await api().downloads.resume(id))),
    [patchOne]
  )
  const cancel = useCallback(
    async (id: number) => {
      patchOne(unwrap(await api().downloads.cancel(id)))
      void refresh()
    },
    [patchOne, refresh]
  )

  const reorder = useCallback(async (orderedIds: number[]) => {
    const list = unwrap(await api().downloads.reorder({ orderedIds }))
    setItems(list)
  }, [])

  const clearCompleted = useCallback(async () => {
    unwrap(await api().downloads.clearCompleted())
    await refresh()
  }, [refresh])

  const downloadedStreamIds = useMemo(() => {
    const set = new Set<number>()
    for (const it of items) {
      if (it.status === 'completed' || ACTIVE_STATUSES.has(it.status)) set.add(it.streamId)
    }
    return set
  }, [items])

  const value: DownloadsContextValue = {
    items,
    loading,
    error,
    downloadedStreamIds,
    add,
    pause,
    resume,
    cancel,
    reorder,
    clearCompleted,
    reload: () => void refresh(),
    getLiveProgress: (id: number) => progressCache.current.get(id)
  }

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>
}

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext)
  if (!ctx) throw new Error('useDownloads must be used within a DownloadsProvider')
  return ctx
}
