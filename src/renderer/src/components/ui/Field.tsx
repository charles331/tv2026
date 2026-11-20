import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react'
import { navigateByDirection } from '@noriginmedia/norigin-spatial-navigation'
import { cn } from './cn'
import { useFocusItem } from '../../lib/remote/focus'

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
  /** Stable key for the remote-control navigation (setFocus target). */
  focusKey?: string
  /** Search/filter field: Back empties it before going back (remote control). */
  clearOnBack?: boolean
}

export function TextInput({
  invalid,
  className,
  focusKey,
  clearOnBack,
  disabled,
  onMouseDown,
  ...rest
}: TextInputProps): ReactElement {
  // OK in a field moves on to what is below it (usually the results).
  const { ref, itemProps } = useFocusItem<HTMLInputElement>({
    focusKey,
    focusable: !disabled,
    // In a form (Settings: credentials), OK submits it like Enter always did.
    onEnter: () => {
      const form = ref.current?.form
      if (form) form.requestSubmit()
      else void navigateByDirection('down')
    }
  })
  return (
    <input
      ref={ref}
      disabled={disabled}
      data-remote-focus={itemProps['data-remote-focus']}
      data-remote=""
      data-clear-on-back={clearOnBack ? '' : undefined}
      onMouseDown={(e) => {
        itemProps.onMouseDown()
        onMouseDown?.(e)
      }}
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
