import { useCallback, useMemo, useState, type ReactElement } from 'react'
import type { DownloadItem } from '@shared/index'
import { useDownloads } from '../../lib/downloads'
import { useConnectionBusy } from '../../lib/connectionLock'
import { describeError } from '../../lib/ipc'
import { Button, LoadingState, EmptyState, ErrorState, IconQueue } from '../../components/ui'
import { DownloadRow } from './DownloadRow'

const ACTIVE: ReadonlySet<DownloadItem['status']> = new Set(['queued', 'downloading', 'paused'])
const DONE: ReadonlySet<DownloadItem['status']> = new Set(['completed', 'failed', 'canceled'])

export function DownloadsScreen(): ReactElement {
  const dl = useDownloads()
  const busy = useConnectionBusy()
  const [actionError, setActionError] = useState<string | null>(null)

  const active = useMemo(
    () =>
      dl.items
        .filter((it) => ACTIVE.has(it.status))
        .sort((a, b) => a.queuePosition - b.queuePosition),
    [dl.items]
  )
  const history = useMemo(
    () => dl.items.filter((it) => DONE.has(it.status)).sort((a, b) => b.updatedAt - a.updatedAt),
    [dl.items]
  )

  const run = useCallback(async (fn: () => Promise<void>) => {
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(describeError(e))
    }
  }, [])

  const move = useCallback(
    (id: number, dir: -1 | 1) => {
      const ids = active.map((it) => it.id)
      const idx = ids.indexOf(id)
      const swap = idx + dir
      if (idx < 0 || swap < 0 || swap >= ids.length) return
      const reordered = [...ids]
      const moved = reordered.splice(idx, 1)
      reordered.splice(swap, 0, ...moved)
      void run(() => dl.reorder(reordered))
    },
    [active, dl, run]
  )

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-6 fade-in">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Téléchargements</h1>
          <p className="mt-1 text-sm text-gray-400">
            File séquentielle (une connexion à la fois).
            {busy.busy && busy.reason === 'playback' && (
              <span className="text-amber-300"> En pause pour lecture.</span>
            )}
          </p>
        </div>
        {history.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void run(dl.clearCompleted)}>
            Vider l’historique
          </Button>
        )}
      </header>

      {actionError && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
        {dl.loading ? (
          <LoadingState />
        ) : dl.error ? (
          <ErrorState message={dl.error} onRetry={dl.reload} />
        ) : active.length === 0 && history.length === 0 ? (
          <EmptyState
            icon={<IconQueue size={36} />}
            title="Aucun téléchargement"
            description="Ajoutez des films depuis le catalogue pour les retrouver ici."
          />
        ) : (
          <>
            {active.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  File active ({active.length})
                </h2>
                {active.map((item, i) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    live={dl.getLiveProgress(item.id)}
                    busyReason={busy.busy ? busy.reason : null}
                    canMoveUp={i > 0}
                    canMoveDown={i < active.length - 1}
                    onPause={(id) => void run(() => dl.pause(id))}
                    onResume={(id) => void run(() => dl.resume(id))}
                    onCancel={(id) => void run(() => dl.cancel(id))}
                    onMoveUp={(id) => move(id, -1)}
                    onMoveDown={(id) => move(id, 1)}
                  />
                ))}
              </section>
            )}

            {history.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Historique ({history.length})
                </h2>
                {history.map((item) => (
                  <DownloadRow
                    key={item.id}
                    item={item}
                    busyReason={null}
                    canMoveUp={false}
                    canMoveDown={false}
                    onPause={(id) => void run(() => dl.pause(id))}
                    onResume={(id) => void run(() => dl.resume(id))}
                    onCancel={(id) => void run(() => dl.cancel(id))}
                    onMoveUp={() => undefined}
                    onMoveDown={() => undefined}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
