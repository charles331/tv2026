/**
 * Index-based navigation in a grid of `count` items laid out in `columns`
 * columns (row-major). Used by the big poster grids, whose off-screen cards
 * are not in the DOM, so geometric navigation cannot see them.
 *
 * 'exit' means the move leaves the grid: the spatial navigation then picks the
 * neighbouring zone (toolbar above, categories on the left).
 */
export type GridDirection = 'up' | 'down' | 'left' | 'right'

export function gridStep(
  index: number,
  dir: GridDirection,
  columns: number,
  count: number
): number | 'exit' {
  if (count <= 0 || columns <= 0) return 'exit'
  const col = index % columns
  const row = Math.floor(index / columns)
  const lastRow = Math.floor((count - 1) / columns)
  switch (dir) {
    case 'left':
      return col === 0 ? 'exit' : index - 1
    case 'right':
      return index + 1 >= count ? 'exit' : index + 1
    case 'up':
      return row === 0 ? 'exit' : index - columns
    case 'down':
      return row >= lastRow ? 'exit' : Math.min(index + columns, count - 1)
  }
}

/** True when `index` sits in the last two loaded rows and more items exist. */
export function shouldLoadMore(
  index: number,
  columns: number,
  count: number,
  hasMore: boolean
): boolean {
  if (!hasMore || count <= 0 || columns <= 0) return false
  const lastRow = Math.floor((count - 1) / columns)
  return Math.floor(index / columns) >= lastRow - 1
}
