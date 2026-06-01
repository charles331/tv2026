import type { ReactElement, ReactNode } from 'react'
import { Spinner } from './Spinner'
import { Button } from './Button'
import { cn } from './cn'

/** Centered loading state. */
export function LoadingState({ label = 'Chargement…' }: { label?: string }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
      <Spinner size={28} />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/** Centered empty state with an optional icon and action. */
export function EmptyState({
  title,
  description,
  icon,
  action
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-gray-600">{icon}</div>}
      <h3 className="text-base font-medium text-gray-200">{title}</h3>
      {description && <p className="max-w-md text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Error state with a retry affordance. */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Réessayer',
  className
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 8v5m0 3.5h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="max-w-md text-sm text-gray-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
