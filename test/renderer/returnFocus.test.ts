import { describe, it, expect, vi } from 'vitest'
import { ReturnFocus } from '../../src/renderer/src/lib/remote/returnFocus'

function setup(current: string) {
  const state = { current }
  const focus = vi.fn((k: string) => {
    state.current = k
  })
  const rf = new ReturnFocus({
    getCurrent: () => state.current,
    exists: () => true,
    focus
  })
  return { rf, focus, state }
}

describe('ReturnFocus', () => {
  it('gives the selection back to what had it before the overlay', () => {
    vi.useFakeTimers()
    const { rf, focus, state } = setup('poster')
    const close = rf.open()
    state.current = 'overlay-button'
    close()
    vi.runAllTimers()
    expect(focus).toHaveBeenLastCalledWith('poster')
  })
  it('an overlay replaced by another one does not steal the new one’s selection', () => {
    vi.useFakeTimers()
    const { rf, focus, state } = setup('poster')
    const closeFirst = rf.open()
    state.current = 'first-button'
    closeFirst() // first conflict answered…
    const closeSecond = rf.open() // …the second one opens in the same commit
    state.current = 'second-button'
    vi.runAllTimers()
    expect(focus).not.toHaveBeenCalled()
    closeSecond()
    vi.runAllTimers()
    expect(focus).toHaveBeenLastCalledWith('poster') // back to the original place
  })
})
