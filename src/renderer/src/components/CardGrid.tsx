/**
 * A small, non-virtualized grid of cards that the remote control walks as one
 * focusable (index navigation, like the big catalogue grids). Used for the
 * result sections of the global search.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useGridNavigation } from '../lib/remote/useGridNavigation'

const GAP = 16 // px, Tailwind gap-4

export function CardGrid<T>({
  items,
  focusKey,
  minCardWidth,
  onActivate,
  onActiveChange,
  renderCard
}: {
  items: T[]
  focusKey: string
  minCardWidth: number
  onActivate: (item: T) => void
  /** The card the remote selection is on (kept when the selection leaves the grid). */
  onActiveChange?: (index: number) => void
  renderCard: (item: T, index: number, active: boolean, onPointerSelect: () => void) => ReactElement
}): ReactElement {
  const [width, setWidth] = useState(0)
  const columns = Math.max(1, Math.floor((width + GAP) / (minCardWidth + GAP)))
  const nav = useGridNavigation<HTMLDivElement>({
    count: items.length,
    columns,
    hasMore: false,
    onLoadMore: () => undefined,
    onActivate: (i) => {
      const item = items[i]
      if (item !== undefined) onActivate(item)
    },
    focusKey
  })
  const { ref, activeIndex, focused } = nav

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])

  useEffect(() => {
    if (!focused) return
    ref.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, focused, ref])

  useEffect(() => {
    onActiveChange?.(activeIndex)
  }, [activeIndex, onActiveChange])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-remote=""
      className="grid gap-4 outline-none"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))` }}
    >
      {items.map((item, i) =>
        renderCard(item, i, focused && i === activeIndex, () => {
          nav.setActiveIndex(i)
          nav.focusSelf()
        })
      )}
    </div>
  )
}
