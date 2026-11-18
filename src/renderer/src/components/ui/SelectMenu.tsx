/**
 * Drop-in replacement for a native <select>, usable with a remote control: a
 * button showing the current choice; OK opens a small list (the selection
 * stays inside it), ↑/↓ pick, OK applies, Back closes without changing.
 * (A native <select> popup does not cooperate with the spatial navigation.)
 */
import { useContext, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { cn } from './cn'
import { FocusButton } from './FocusButton'
import {
  FocusZone,
  ScreenActiveContext,
  useBackHandler,
  useReturnFocus
} from '../../lib/remote/focus'

export function SelectMenu<T extends string>({
  focusKey,
  value,
  options,
  onChange,
  disabled,
  title
}: {
  focusKey: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  title: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // A list left open in a screen that gets hidden would keep its Back handler
  // on top of the stack: close it.
  const screenActive = useContext(ScreenActiveContext)
  useEffect(() => {
    if (!screenActive) setOpen(false)
  }, [screenActive])
  const current = options.find((o) => o.value === value)?.label ?? value
  return (
    <div ref={rootRef} className="relative">
      <FocusButton
        focusKey={focusKey}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-surface-sunken px-3 text-sm text-gray-200 hover:border-white/20 disabled:opacity-40"
      >
        {current}
        <span aria-hidden className="text-gray-500">
          ▾
        </span>
      </FocusButton>
      {open && (
        <SelectList
          containerRef={rootRef}
          focusKey={`${focusKey}-list`}
          value={value}
          options={options}
          onPick={(v) => {
            setOpen(false)
            if (v !== value) onChange(v)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function SelectList<T extends string>({
  containerRef,
  focusKey,
  value,
  options,
  onPick,
  onClose
}: {
  /** The whole menu (trigger + list): a click there is not "outside". */
  containerRef: RefObject<HTMLDivElement | null>
  focusKey: string
  value: T
  options: { value: T; label: string }[]
  onPick: (value: T) => void
  onClose: () => void
}): ReactElement {
  useReturnFocus()
  useBackHandler(onClose)
  useEffect(() => {
    setFocus(`${focusKey}-${value}`)
    // Click outside closes, like a native menu.
    const onDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once
  }, [])
  return (
    <div className="absolute right-0 top-full z-30 mt-1 min-w-full">
      <FocusZone
        focusKey={focusKey}
        boundary
        className="rounded-lg border border-white/10 bg-surface-raised p-1 shadow-xl"
      >
        <ul role="listbox">
          {options.map((o) => (
            <li key={o.value}>
              <FocusButton
                focusKey={`${focusKey}-${o.value}`}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => onPick(o.value)}
                className={cn(
                  'block w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-sm',
                  o.value === value
                    ? 'bg-accent/20 text-accent-hover'
                    : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'
                )}
              >
                {o.label}
              </FocusButton>
            </li>
          ))}
        </ul>
      </FocusZone>
    </div>
  )
}
