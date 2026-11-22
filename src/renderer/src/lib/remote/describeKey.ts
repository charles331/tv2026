/** What the remote-control tester shows for one key press. */
import { keyToAction, type RemoteAction } from './keys'

export interface KeyDescription {
  key: string
  code: string
  keyCode: number
  action: RemoteAction | null
}

export function describeKey(e: { key: string; code: string; keyCode: number }): KeyDescription {
  return {
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    // Outside a text field: what the key does while browsing.
    action: keyToAction(e, { inTextField: false })
  }
}
