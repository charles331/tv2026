/**
 * Player controller hook: wraps `window.api.player`, subscribes to position /
 * state events, and exposes typed actions. Tolerates the mpv backend being a
 * stub (NOT_IMPLEMENTED) by surfacing an "unavailable" flag instead of crashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerStatus, PlayRequest, Result } from '@shared/index'
import { api, describeError } from '../../lib/ipc'

const IDLE_STATUS: PlayerStatus = {
  state: 'idle',
  positionSecs: 0,
  durationSecs: null,
  volume: 100,
  muted: false,
  fullscreen: false,
  source: null,
  title: null
}

export interface PlayerController {
  status: PlayerStatus
  /** True when the mpv backend reports NOT_IMPLEMENTED (preparing). */
  unavailable: boolean
  error: string | null
  play: (req: PlayRequest) => Promise<void>
  togglePlay: () => Promise<void>
  stop: () => Promise<void>
  seek: (positionSecs: number) => Promise<void>
  setVolume: (volume: number, muted?: boolean) => Promise<void>
  toggleMute: () => Promise<void>
  setFullscreen: (fullscreen: boolean) => Promise<void>
}

export function usePlayer(): PlayerController {
  const [status, setStatus] = useState<PlayerStatus>(IDLE_STATUS)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  // Live position / state ticks from main.
  useEffect(() => {
    const offPos = api().player.onPosition((e) => {
      setStatus((s) => ({
        ...s,
        positionSecs: e.positionSecs,
        durationSecs: e.durationSecs,
        state: e.state
      }))
    })
    const offState = api().player.onState((e) => {
      setStatus((s) => ({ ...s, state: e.state, error: e.error }))
      if (e.state === 'error' && e.error) setError(e.error)
    })
    return () => {
      offPos()
      offState()
    }
  }, [])

  // Apply a Result from the player API: update status or flag unavailable.
  const apply = useCallback(async (call: Promise<Result<PlayerStatus>>): Promise<void> => {
    setError(null)
    try {
      const r = await call
      if (r.ok) {
        setStatus(r.data)
        setUnavailable(false)
      } else if (r.error.code === 'NOT_IMPLEMENTED') {
        // mpv backend not wired yet — show "préparation" instead of an error.
        setUnavailable(true)
      } else {
        setError(r.error.message)
      }
    } catch (e) {
      setError(describeError(e))
    }
  }, [])

  const play = useCallback(
    (req: PlayRequest) => {
      setStatus((s) => ({ ...s, state: 'loading', title: req.title ?? s.title }))
      return apply(api().player.play(req))
    },
    [apply]
  )

  const togglePlay = useCallback(() => {
    const playing = statusRef.current.state === 'playing'
    return apply(playing ? api().player.pause() : api().player.resume())
  }, [apply])

  const stop = useCallback(() => apply(api().player.stop()), [apply])

  const seek = useCallback(
    (positionSecs: number) => apply(api().player.seek({ positionSecs })),
    [apply]
  )

  const setVolume = useCallback(
    (volume: number, muted?: boolean) => apply(api().player.setVolume({ volume, muted })),
    [apply]
  )

  const toggleMute = useCallback(() => {
    const s = statusRef.current
    return apply(api().player.setVolume({ volume: s.volume, muted: !s.muted }))
  }, [apply])

  const setFullscreen = useCallback(
    (fullscreen: boolean) => apply(api().player.setFullscreen({ fullscreen })),
    [apply]
  )

  return {
    status,
    unavailable,
    error,
    play,
    togglePlay,
    stop,
    seek,
    setVolume,
    toggleMute,
    setFullscreen
  }
}
