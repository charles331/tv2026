import { describe, it, expect } from 'vitest'
import { gridStep, shouldLoadMore } from '../../src/renderer/src/lib/remote/grid'

describe('gridStep (5 columns, 12 items)', () => {
  it('moves inside the grid', () => {
    expect(gridStep(0, 'right', 5, 12)).toBe(1)
    expect(gridStep(4, 'right', 5, 12)).toBe(5)
    expect(gridStep(7, 'up', 5, 12)).toBe(2)
    expect(gridStep(1, 'left', 5, 12)).toBe(0)
  })
  it('clamps down to the last item of a partial last row', () => {
    expect(gridStep(7, 'down', 5, 12)).toBe(11)
    expect(gridStep(2, 'down', 5, 12)).toBe(7)
  })
  it('exits at the edges', () => {
    expect(gridStep(11, 'right', 5, 12)).toBe('exit')
    expect(gridStep(5, 'left', 5, 12)).toBe('exit')
    expect(gridStep(0, 'left', 5, 12)).toBe('exit')
    expect(gridStep(2, 'up', 5, 12)).toBe('exit')
    expect(gridStep(10, 'down', 5, 12)).toBe('exit')
  })
  it('exits from an empty grid', () => {
    expect(gridStep(0, 'down', 5, 0)).toBe('exit')
  })
})

describe('shouldLoadMore', () => {
  it('is true within the last two loaded rows when more exist', () => {
    expect(shouldLoadMore(5, 5, 12, true)).toBe(true)
    expect(shouldLoadMore(11, 5, 12, true)).toBe(true)
    expect(shouldLoadMore(0, 5, 12, true)).toBe(false)
    expect(shouldLoadMore(4, 5, 12, true)).toBe(false)
    expect(shouldLoadMore(11, 5, 12, false)).toBe(false)
  })
})
