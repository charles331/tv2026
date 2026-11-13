import type { ReactElement } from 'react'
import { progressRatio } from '@shared/index'
import type { WatchProgress } from '@shared/index'
import { cn } from '../../components/ui'

/** Thin "already played" bar; renders nothing when there is nothing to show. */
export function WatchProgressBar({
  progress,
  className
}: {
  progress: WatchProgress | null | undefined
  className?: string
}): ReactElement | null {
  const ratio = progressRatio(progress)
  if (ratio <= 0 || progress?.watched) return null
  return (
    <div
      className={cn('h-1 overflow-hidden rounded-full bg-white/15', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label="Déjà regardé"
    >
      <div className="h-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  )
}
