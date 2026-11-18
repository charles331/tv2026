import { describe, it, expect } from 'vitest'
import { describeKey } from '../../src/renderer/src/lib/remote/describeKey'

describe('describeKey', () => {
  it('reports the raw key fields and the recognised action', () => {
    expect(describeKey({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 })).toEqual({
      key: 'ArrowUp',
      code: 'ArrowUp',
      keyCode: 38,
      action: 'up'
    })
    expect(describeKey({ key: 'Unidentified', code: '', keyCode: 166 }).action).toBe('back')
  })
  it('has no action for a key the remote map does not know', () => {
    expect(
      describeKey({ key: 'MediaPlayPause', code: 'MediaPlayPause', keyCode: 179 }).action
    ).toBeNull()
  })
})
