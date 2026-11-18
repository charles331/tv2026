/**
 * A whole grid as ONE remote-control focusable: arrows move an index (the
 * off-screen cards of a virtualized grid are not in the DOM, so geometric
 * navigation cannot reach them); at an edge the arrow is handed back to the
 * spatial navigation, which picks the neighbouring zone.
 */
import { useRef, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { gridStep, shouldLoadMore, type GridDirection } from './grid'

export function useGridNavigation<E extends HTMLElement = HTMLDivElement>({
  count,
  columns,
  hasMore,
  onLoadMore,
  onActivate,
  focusKey
}: {
  count: number
  columns: number
  hasMore: boolean
  onLoadMore: () => void
  onActivate: (index: number) => void
  focusKey: string
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const index = count > 0 ? Math.min(activeIndex, count - 1) : 0
  const latest = useRef({ index, count, columns, hasMore, onLoadMore, onActivate })
  latest.current = { index, count, columns, hasMore, onLoadMore, onActivate }

  const { ref, focused, focusSelf } = useFocusable<object, E>({
    focusKey,
    focusable: count > 0,
    onEnterPress: () => {
      const l = latest.current
      if (l.count > 0) l.onActivate(l.index)
    },
    onArrowPress: (dir) => {
      const l = latest.current
      const next = gridStep(l.index, dir as GridDirection, l.columns, l.count)
      if (next === 'exit') return true
      setActiveIndex(next)
      if (shouldLoadMore(next, l.columns, l.count, l.hasMore)) l.onLoadMore()
      return false
    }
  })
  return { ref, focused, focusSelf, activeIndex: index, setActiveIndex }
}
