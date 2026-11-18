import { describe, it, expect, vi } from 'vitest'
import { BackStack } from '../../src/renderer/src/lib/remote/backStack'

describe('BackStack', () => {
  it('calls the most recent handler only', () => {
    const s = new BackStack()
    const a = vi.fn()
    const b = vi.fn()
    s.push(a)
    s.push(b)
    expect(s.dispatch()).toBe(true)
    expect(b).toHaveBeenCalledOnce()
    expect(a).not.toHaveBeenCalled()
  })
  it('falls back to the previous handler once the latest is removed', () => {
    const s = new BackStack()
    const a = vi.fn()
    s.push(a)
    const removeB = s.push(vi.fn())
    removeB()
    s.dispatch()
    expect(a).toHaveBeenCalledOnce()
  })
  it('removing a handler twice or out of order is harmless', () => {
    const s = new BackStack()
    const removeA = s.push(vi.fn())
    const removeB = s.push(vi.fn())
    removeA()
    removeA()
    expect(s.size()).toBe(1)
    removeB()
    expect(s.size()).toBe(0)
    expect(s.dispatch()).toBe(false)
  })
  it('returns false when empty', () => {
    expect(new BackStack().dispatch()).toBe(false)
  })
})
