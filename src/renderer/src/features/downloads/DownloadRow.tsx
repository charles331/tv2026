import { type ReactElement } from 'react'
import type { DownloadItem, DownloadProgressEvent } from '@shared/index'
import {
  Badge,
  Button,
  ProgressBar,
  IconPause,
  IconResume,
  IconRefresh,
  IconX,
  IconGrip
} from '../../components/ui'
import { formatBytes, formatEta, formatPercent, formatSpeed } from '../../lib/format'

const STATUS_META: Record<
  DownloadItem['status'],
  { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  queued: { label: 'En attente', tone: 'neutral' },
  downloading: { label: 'En cours', tone: 'info' },
  paused: { label: 'En pause', tone: 'warning' },
  completed: { label: 'Terminé', tone: 'success' },
  failed: { label: 'Échoué', tone: 'danger' },
  canceled: { label: 'Annulé', tone: 'neutral' }
}

export function DownloadRow({
  item,
  live,
  busyReason,
  canMoveUp,
  canMoveDown,
  onPause,
  onResume,
  onCancel,
  onMoveUp,
  onMoveDown
}: {
  item: DownloadItem
  live?: DownloadProgressEvent
  busyReason: 'download' | 'playback' | null
  canMoveUp: boolean
  canMoveDown: boolean
  onPause: (id: number) => void
  onResume: (id: number) => void
  onCancel: (id: number) => void
  onMoveUp: (id: number) => void
  onMoveDown: (id: number) => void
}): ReactElement {
  const meta = STATUS_META[item.status]
  const isActive = item.status === 'downloading'
  const isQueued = item.status === 'queued'
  const isPaused = item.status === 'paused'
  const received = live?.receivedBytes ?? item.receivedBytes
  const total = live?.totalBytes ?? item.totalBytes
  const progress = live?.progress ?? item.progress
  const speed = live?.speedBps
  const eta = live?.etaSecs

  const pausedForPlayback = isPaused && busyReason === 'playback'

  return (
    <div className="rounded-xl border border-white/10 bg-surface-raised p-4">
      <div className="flex items-start gap-3">
        {(isQueued || isPaused) && (
          <div className="flex flex-col gap-0.5 pt-0.5 text-gray-600">
            <button
              type="button"
              disabled={!canMoveUp}
              onClick={() => onMoveUp(item.id)}
              className="rotate-180 rounded p-0.5 hover:bg-white/10 hover:text-gray-300 disabled:opacity-30"
              title="Monter"
              aria-label="Monter dans la file"
            >
              <IconGrip size={12} />
            </button>
            <button
              type="button"
              disabled={!canMoveDown}
              onClick={() => onMoveDown(item.id)}
              className="rounded p-0.5 hover:bg-white/10 hover:text-gray-300 disabled:opacity-30"
              title="Descendre"
              aria-label="Descendre dans la file"
            >
              <IconGrip size={12} />
            </button>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-gray-100" title={item.fileName}>
              {item.name}
            </p>
            <Badge tone={meta.tone}>
              {pausedForPlayback ? 'En pause pour lecture' : meta.label}
            </Badge>
          </div>

          <div className="mt-2">
            <ProgressBar
              value={progress}
              tone={
                item.status === 'completed'
                  ? 'success'
                  : item.status === 'failed'
                    ? 'danger'
                    : isActive
                      ? 'accent'
                      : 'neutral'
              }
            />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-500">
            <span>
              {formatBytes(received)}
              {total != null ? ` / ${formatBytes(total)}` : ''}
            </span>
            {progress != null && <span>{formatPercent(progress)}</span>}
            {isActive && speed != null && speed > 0 && <span>{formatSpeed(speed)}</span>}
            {isActive && eta != null && <span>restant {formatEta(eta)}</span>}
            {item.status === 'failed' && item.error && (
              <span className="text-red-300">{item.error}</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-1">
          {isActive && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconPause size={14} />}
              onClick={() => onPause(item.id)}
            >
              Pause
            </Button>
          )}
          {(isPaused || isQueued) && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconResume size={14} />}
              onClick={() => onResume(item.id)}
            >
              Reprendre
            </Button>
          )}
          {item.status === 'failed' && (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconRefresh size={14} />}
              onClick={() => onResume(item.id)}
              title="Relancer le téléchargement (reprend là où il s’est arrêté)"
            >
              Réessayer
            </Button>
          )}
          {item.status !== 'completed' && item.status !== 'canceled' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconX size={14} />}
              onClick={() => onCancel(item.id)}
              aria-label="Annuler"
            >
              {item.status === 'failed' ? 'Retirer' : 'Annuler'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
