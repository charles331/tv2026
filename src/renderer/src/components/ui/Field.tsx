import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react'
import { cn } from './cn'

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-300">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-gray-500">{hint}</span>
      ) : null}
    </label>
  )
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function TextInput({ invalid, className, ...rest }: TextInputProps): ReactElement {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border bg-surface-sunken px-3 text-sm text-gray-100',
        'placeholder:text-gray-600 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-accent/70',
        invalid ? 'border-red-500/60' : 'border-white/10 focus:border-accent/60',
        className
      )}
      {...rest}
    />
  )
}
