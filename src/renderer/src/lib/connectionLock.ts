/**
 * Subscribe to the shared ConnectionLock busy state.
 * `reason === 'playback'` => show "en pause pour lecture" affordances.
 */

import { useEffect, useState } from 'react'
import { api } from './ipc'

export interface BusyState {
  busy: boolean
  reason: 'download' | 'playback' | null
}

export function useConnectionBusy(): BusyState {
  const [state, setState] = useState<BusyState>({ busy: false, reason: null })
  useEffect(() => {
    return api().connectionLock.onBusyChange((e) => setState({ busy: e.busy, reason: e.reason }))
  }, [])
  return state
}
