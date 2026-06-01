import type { ReactElement } from 'react'
import { cn } from './cn'

/** Determinate (0..1) or indeterminate progress bar. */
export function ProgressBar({
  value,
  tone = 'accent',
  className
}: {
  /** 0..1, or null for indeterminate. */
  value: number | null
  tone?: 'accent' | 'success' | 'danger' | 'neutral'
  className?: string
}): ReactElement {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-400'
      : tone === 'danger'
        ? 'bg-red-400'
        : tone === 'neutral'
          ? 'bg-gray-400'
          : 'bg-accent'
  const pct = value == null ? null : Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      {pct == null ? (
        <div className={cn('h-full w-1/3 animate-pulse rounded-full', toneClass)} />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', toneClass)}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}
