/**
 * "Reprendre": movies or episodes started but not finished, most recent first.
 * One click resumes where the user stopped.
 */
import type { ReactElement } from 'react'
import type { WatchProgress } from '@shared/index'
import { useProgress } from '../../lib/progress'
import { formatClock, formatDuration } from '../../lib/format'
import { Button, Poster, EmptyState, IconPlay, IconResume, IconX } from '../../components/ui'
import { WatchProgressBar } from './ProgressBar'

export function ContinueView({
  kind,
  onResume
}: {
  kind: 'movie' | 'series'
  onResume: (item: WatchProgress) => void
}): ReactElement {
  const progress = useProgress()
  const items = progress.inProgress(kind)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconResume size={36} />}
        title="Rien à reprendre"
        description={
          kind === 'movie'
            ? 'Les films commencés mais pas terminés apparaissent ici, pour reprendre où vous vous êtes arrêté.'
            : 'Les épisodes commencés mais pas terminés apparaissent ici, pour reprendre où vous vous êtes arrêté.'
        }
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto px-1 py-1">
      <ul className="space-y-2">
        {items.map((p) => {
          const remaining =
            p.durationSecs != null && p.durationSecs > p.positionSecs
              ? p.durationSecs - p.positionSecs
              : null
          return (
            <li
              key={p.itemId}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface-raised p-3"
            >
              <button
                type="button"
                onClick={() => onResume(p)}
                title={`Reprendre ${p.name}`}
                className="group flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="block h-16 w-11 shrink-0 overflow-hidden rounded bg-surface-sunken">
                  <Poster src={p.image} alt={p.name} className="h-full w-full" />
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-100 group-hover:text-white group-hover:underline">
                    {p.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Arrêté à {formatClock(p.positionSecs)}
                    {remaining != null && ` · reste ${formatDuration(remaining)}`}
                  </span>
                  <WatchProgressBar progress={p} className="mt-1.5 max-w-sm" />
                </span>
              </button>
              <Button size="sm" variant="primary" icon={<IconPlay size={14} />} onClick={() => onResume(p)}>
                Reprendre
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconX size={14} />}
                title="Retirer de la liste (oublie la position)"
                onClick={() => void progress.clear(p.kind, p.itemId)}
              >
                <span className="sr-only">Retirer</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
