import type { ReactElement, ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/10 text-gray-300',
  accent: 'bg-accent/20 text-accent-hover',
  success: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-red-500/15 text-red-300',
  info: 'bg-sky-500/15 text-sky-300'
}

export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
