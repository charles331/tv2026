import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { SeriesStream } from '@shared/index'
import { SeriesCard } from './SeriesCard'
import { useGridNavigation } from '../../lib/remote/useGridNavigation'

const MIN_CARD_WIDTH = 168 // px, as in gridTemplateColumns below
const GAP = 16 // px, Tailwind gap-4

/**
 * Responsive series grid with sentinel-based infinite scroll. Series catalogues
 * are far smaller than the 26k movie list, so a plain CSS grid (no row
 * virtualization) is enough.
 */
export function SeriesGrid({
  items,
  total,
  loadingMore,
  hasMore,
  onLoadMore,
  onSelect,
  focusKey
}: {
  items: SeriesStream[]
  total: number
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  onSelect: (series: SeriesStream) => void
  /** Remote-control key of the grid (one focusable for the whole grid). */
  focusKey: string
}): ReactElement {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP)))

  // Remote control: arrows move an index, OK opens the active series.
  const nav = useGridNavigation<HTMLDivElement>({
    count: items.length,
    columns,
    hasMore: hasMore && !loadingMore,
    onLoadMore,
    onActivate: (i) => {
      const series = items[i]
      if (series) onSelect(series)
    },
    focusKey
  })
  const { activeIndex, focused } = nav
  const scrollRef = nav.ref

  // Columns follow the width (the CSS grid is auto-fill).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [scrollRef])

  // Keep the active card in view.
  useEffect(() => {
    if (!focused) return
    scrollRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, focused, scrollRef])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loadingMore) onLoadMore()
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  return (
    <div
      ref={scrollRef}
      tabIndex={-1}
      data-remote=""
      className="h-full overflow-y-auto p-2 outline-none"
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}
      >
        {items.map((s, i) => (
          <SeriesCard
            key={s.seriesId}
            index={i}
            series={s}
            onSelect={onSelect}
            active={focused && i === activeIndex}
            onPointerSelect={() => {
              nav.setActiveIndex(i)
              nav.focusSelf()
            }}
          />
        ))}
      </div>
      <div ref={sentinelRef} />
      {loadingMore && (
        <div className="py-4 text-center text-xs text-gray-500">Chargement de plus de séries…</div>
      )}
      {!hasMore && items.length > 0 && (
        <div className="py-4 text-center text-xs text-gray-600">
          {items.length} sur {total} séries affichées
        </div>
      )}
    </div>
  )
}
