/**
 * Playback progress bar: played part filled (accent), part already loaded by mpv
 * in light grey ahead of the cursor, hover preview of the target time, click or
 * drag to seek, ←/→ = ±10 s. Live streams have no meaningful duration: the bar
 * then only shows how many seconds are loaded ahead (30 s window), no cursor.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { formatClock } from '../../lib/format'
import { cn } from '../../components/ui'
import { liveBufferFill, seekGeometry, LIVE_BUFFER_WINDOW_SECS } from './seekGeometry'

export function SeekBar({
  positionSecs,
  bufferedSecs,
  durationSecs,
  live,
  disabled,
  onSeek
}: {
  positionSecs: number
  bufferedSecs: number | null | undefined
  durationSecs: number | null | undefined
  live: boolean
  disabled: boolean
  onSeek: (secs: number) => void
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverSecs, setHoverSecs] = useState<number | null>(null)
  const [dragSecs, setDragSecs] = useState<number | null>(null)
  const duration = durationSecs ?? 0

  if (live) {
    const { aheadSecs, pct } = liveBufferFill(positionSecs, bufferedSecs)
    return (
      <div className="flex flex-1 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-red-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> DIRECT
        </span>
        <div
          className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10"
          title={`${Math.round(aheadSecs)} s déjà chargées d’avance (barre pleine = ${LIVE_BUFFER_WINDOW_SECS} s)`}
          aria-label="Avance chargée"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/35 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-24 shrink-0 text-xs tabular-nums text-gray-500">{Math.round(aheadSecs)} s d’avance</span>
      </div>
    )
  }

  const canSeek = !disabled && duration > 0
  const shownPos = dragSecs ?? positionSecs
  const { playedPct, bufferedPct } = seekGeometry(shownPos, bufferedSecs, duration)

  const secsAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (!canSeek) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragSecs(secsAt(e.clientX))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!canSeek) return
    const s = secsAt(e.clientX)
    setHoverSecs(s)
    if (dragSecs !== null) setDragSecs(s)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragSecs === null) return
    onSeek(secsAt(e.clientX))
    setDragSecs(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!canSeek) return
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, positionSecs - 10))
    else if (e.key === 'ArrowRight') onSeek(Math.min(duration, positionSecs + 10))
    else return
    e.preventDefault()
  }

  const tipSecs = dragSecs ?? hoverSecs
  const tipPct = tipSecs != null && duration > 0 ? (tipSecs / duration) * 100 : null

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={canSeek ? 0 : -1}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shownPos)}
      aria-valuetext={formatClock(shownPos, duration)}
      aria-disabled={!canSeek}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverSecs(null)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-5 flex-1 items-center outline-none',
        canSeek ? 'cursor-pointer' : 'cursor-default opacity-40'
      )}
    >
      {/* track */}
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10 transition-[height] group-hover:h-1.5 group-focus-visible:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufferedPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${playedPct}%` }} />
      </div>
      {/* knob: only while hovering / dragging / focused */}
      {canSeek && (
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity',
            dragSecs !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          )}
          style={{ left: `${playedPct}%` }}
        />
      )}
      {/* target time */}
      {canSeek && tipPct !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
          style={{ left: `${Math.min(97, Math.max(3, tipPct))}%` }}
        >
          {formatClock(tipSecs, duration)}
        </div>
      )}
    </div>
  )
}
