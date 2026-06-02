import { useEffect, useRef, type ReactElement } from 'react'
import type { SeriesStream } from '@shared/index'
import { SeriesCard } from './SeriesCard'

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
  onSelect
}: {
  items: SeriesStream[]
  total: number
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  onSelect: (series: SeriesStream) => void
}): ReactElement {
  const sentinelRef = useRef<HTMLDivElement>(null)

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
    <div className="h-full overflow-y-auto px-1 py-1">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}
      >
        {items.map((s) => (
          <SeriesCard key={s.seriesId} series={s} onSelect={onSelect} />
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
