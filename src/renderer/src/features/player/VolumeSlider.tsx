/**
 * Volume slider styled like the progress bar: filled up to the level (accent),
 * knob on hover/drag, click or drag to set, ←/→ = ±5 %, mouse wheel = ±5 %.
 * Muted shows an empty bar (the level is kept and restored on unmute).
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type WheelEvent } from 'react'
import { cn } from '../../components/ui'

const clamp = (v: number): number => Math.min(100, Math.max(0, Math.round(v)))

export function VolumeSlider({
  volume,
  muted,
  disabled,
  onChange
}: {
  volume: number
  muted: boolean
  disabled: boolean
  onChange: (volume: number) => void
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? (muted ? 0 : volume)

  const levelAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? clamp(((clientX - r.left) / r.width) * 100) : shown
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = levelAt(e.clientX)
    setDrag(v)
    onChange(v)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag === null) return
    const v = levelAt(e.clientX)
    setDrag(v)
    onChange(v)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(shown - 5))
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(shown + 5))
    else return
    e.preventDefault()
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (!disabled) onChange(clamp(shown + (e.deltaY < 0 ? 5 : -5)))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`${shown} %`}
      aria-disabled={disabled}
      title={`Volume : ${shown} %`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag(null)}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      className={cn(
        'group relative flex h-5 w-16 items-center outline-none',
        disabled ? 'cursor-default opacity-40' : 'cursor-pointer'
      )}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10 transition-[height] group-hover:h-1.5 group-focus-visible:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${shown}%` }} />
      </div>
      {!disabled && (
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity',
            drag !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          )}
          style={{ left: `${shown}%` }}
        />
      )}
    </div>
  )
}
