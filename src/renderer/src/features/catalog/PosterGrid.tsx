import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { VodStream } from '@shared/index'
import { PosterCard } from './PosterCard'
import { useGridNavigation } from '../../lib/remote/useGridNavigation'

/**
 * Row-virtualized responsive poster grid.
 *
 * Only the rows intersecting the viewport (+ a small overscan) are mounted, so
 * the DOM never holds more than a few dozen poster cards even with thousands of
 * loaded items. Infinite scroll triggers `onLoadMore` near the bottom.
 */

const MIN_CARD_WIDTH = 168 // px; controls responsive column count
const GAP = 16 // px gap between cards
const ASPECT = 3 / 2 // poster height = width * 3/2
const CAPTION_HEIGHT = 56 // px reserved for title/meta under the poster
const ROW_OVERSCAN = 2

export function PosterGrid({
  items,
  total,
  loadingMore,
  hasMore,
  onLoadMore,
  onSelect,
  downloadedStreamIds,
  focusKey
}: {
  items: VodStream[]
  total: number
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  onSelect: (stream: VodStream) => void
  downloadedStreamIds: Set<number>
  /** Remote-control key of the grid (one focusable for the whole grid). */
  focusKey: string
}): ReactElement {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)

  const columns = Math.max(1, Math.floor((viewport.width + GAP) / (MIN_CARD_WIDTH + GAP)))
  const cardWidth =
    columns > 0 ? Math.floor((viewport.width - GAP * (columns - 1)) / columns) : MIN_CARD_WIDTH
  const rowHeight = Math.round(cardWidth * ASPECT) + CAPTION_HEIGHT + GAP
  const rowCount = Math.ceil(items.length / columns)

  // Remote control: arrows move an index over ALL loaded items (most cards are
  // not mounted), OK opens the active one.
  const nav = useGridNavigation<HTMLDivElement>({
    count: items.length,
    columns,
    hasMore: hasMore && !loadingMore,
    onLoadMore,
    onActivate: (i) => {
      const stream = items[i]
      if (stream) onSelect(stream)
    },
    focusKey
  })
  const scrollRef = nav.ref
  const { activeIndex, focused } = nav

  // Track viewport size.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setViewport({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [scrollRef])

  // Keep the active row in view (it may not be mounted yet: computed from rowHeight).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !focused || rowHeight <= 0) return
    const top = Math.floor(activeIndex / columns) * rowHeight
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + rowHeight - el.clientHeight
    }
  }, [activeIndex, focused, columns, rowHeight, scrollRef])
  const totalHeight = rowCount * rowHeight

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_OVERSCAN)
  const visibleRows = Math.ceil(viewport.height / rowHeight) + ROW_OVERSCAN * 2
  const lastRow = Math.min(rowCount, firstRow + visibleRows)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    // Infinite scroll: within 1.5 viewports of the bottom.
    if (hasMore && !loadingMore) {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom < el.clientHeight * 1.5) onLoadMore()
    }
  }, [hasMore, loadingMore, onLoadMore, scrollRef])

  const rows = useMemo(() => {
    const out: ReactElement[] = []
    for (let row = firstRow; row < lastRow; row++) {
      const start = row * columns
      const slice = items.slice(start, start + columns)
      out.push(
        <div
          key={row}
          className="absolute left-0 right-0 flex"
          style={{ top: row * rowHeight, height: rowHeight, gap: GAP }}
        >
          {slice.map((stream, k) => (
            <div key={stream.streamId} style={{ width: cardWidth }}>
              <PosterCard
                stream={stream}
                downloaded={downloadedStreamIds.has(stream.streamId)}
                onSelect={onSelect}
                active={focused && start + k === activeIndex}
                onPointerSelect={() => {
                  nav.setActiveIndex(start + k)
                  nav.focusSelf()
                }}
              />
            </div>
          ))}
        </div>
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nav is a fresh object each render
  }, [
    firstRow,
    lastRow,
    columns,
    items,
    rowHeight,
    cardWidth,
    downloadedStreamIds,
    onSelect,
    focused,
    activeIndex
  ])

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        tabIndex={-1}
        data-remote=""
        onScroll={onScroll}
        className="relative flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 outline-none"
      >
        <div className="relative" style={{ height: totalHeight }}>
          {rows}
        </div>
        {loadingMore && (
          <div className="py-4 text-center text-xs text-gray-500">Chargement de plus de films…</div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="py-4 text-center text-xs text-gray-600">
            {items.length} sur {total} films affichés
          </div>
        )}
      </div>
    </div>
  )
}
