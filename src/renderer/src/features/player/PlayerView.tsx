import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PlayRequest } from '@shared/index'
import {
  Button,
  Spinner,
  cn,
  IconPlay,
  IconPause,
  IconStop,
  IconVolume,
  IconVolumeMute,
  IconFullscreen,
  IconSubtitles,
  IconAudioTrack,
  IconFilm,
  IconRecord
} from '../../components/ui'
import { formatClock } from '../../lib/format'
import { SeekBar } from './SeekBar'
import { VolumeSlider } from './VolumeSlider'
import { useToast } from '../../lib/toast'
import { usePlayer } from './usePlayer'

/**
 * Player transport bar (docked at the bottom of the app).
 *
 * mpv renders the video in its OWN dedicated window (embedding via --wid is
 * unreliable on Electron/Windows). So instead of a blocking full-screen overlay,
 * this is a compact, NON-blocking bar: the user keeps navigating the app while a
 * stream plays in the mpv window. The bar drives mpv over IPC (play/pause/seek/
 * volume/fullscreen + subtitle & audio cycling); the same actions are available
 * directly in the mpv window (f / j / # / right-click).
 */
export function PlayerView({
  request,
  onClose
}: {
  request: PlayRequest
  onClose: () => void
}): ReactElement {
  const player = usePlayer()
  const toast = useToast()
  const { status, unavailable } = player
  // Right-hand time: total duration, or remaining time (click to toggle; remembered).
  const [showRemaining, setShowRemaining] = useState(() => {
    try {
      return localStorage.getItem('tv2026.player.showRemaining') === '1'
    } catch {
      return false
    }
  })
  const toggleRemaining = (): void => {
    setShowRemaining((v) => {
      try {
        localStorage.setItem('tv2026.player.showRemaining', v ? '0' : '1')
      } catch {
        // preference only
      }
      return !v
    })
  }

  // Recording is offered only for live streams (mpv `stream-record`).
  const isLive = request.mediaKind === 'live'
  const recording = status.recording

  const toggleRecord = async (): Promise<void> => {
    if (recording) {
      const ok = await player.stopRecording()
      if (ok) toast.show('Enregistrement arrêté — fichier dans le dossier « Live ».', 'success')
    } else {
      const ok = await player.startRecording(request.title)
      if (ok) toast.show('Enregistrement démarré.', 'success')
      else toast.show('Impossible de démarrer l’enregistrement.', 'error')
    }
  }

  // Kick off playback when the requested source changes; stop on unmount.
  //
  // The stop is deferred by one tick and cancelled if the SAME source is
  // started again right away. React StrictMode (dev only) runs this effect
  // twice — play, cleanup, play — and an immediate stop killed the mpv that
  // was starting; the resulting "idle" then closed this bar, whose unmount
  // stopped the second mpv too: nothing ever played under `pnpm dev`.
  // A real unmount, or a change of source, still stops (on the next tick).
  const sourceKey = `${request.kind}|${request.streamId ?? ''}|${request.filePath ?? ''}`
  const pendingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playingKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const resumedSameSource = pendingStopRef.current !== null && playingKeyRef.current === sourceKey
    if (pendingStopRef.current !== null) {
      clearTimeout(pendingStopRef.current)
      pendingStopRef.current = null
    }
    if (!resumedSameSource) {
      playingKeyRef.current = sourceKey
      void player.play(request)
    }
    return () => {
      pendingStopRef.current = setTimeout(() => {
        pendingStopRef.current = null
        playingKeyRef.current = null
        void player.stop()
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  // Close the transport bar when the mpv window is closed (or playback ends):
  // once playback has actually started, a transition back to idle/ended means
  // the mpv process is gone, so the bar should disappear with it.
  const startedRef = useRef(false)
  useEffect(() => {
    const s = status.state
    if (s === 'loading' || s === 'reconnecting' || s === 'playing' || s === 'paused') {
      startedRef.current = true
    } else if (startedRef.current && (s === 'idle' || s === 'ended')) {
      onClose()
    }
  }, [status.state, onClose])

  // Warn once if a live drop interrupted an in-progress recording (it can't be
  // resumed across the reconnect). A user-initiated stop keeps state 'playing',
  // so this only fires on an actual drop.
  const wasRecordingRef = useRef(false)
  useEffect(() => {
    if (wasRecordingRef.current && !status.recording && status.state === 'reconnecting') {
      toast.show('Enregistrement interrompu : le direct a été coupé.', 'info')
    }
    wasRecordingRef.current = status.recording
  }, [status.recording, status.state, toast])

  const duration = status.durationSecs ?? 0
  const isPlaying = status.state === 'playing'
  const isReconnecting = status.state === 'reconnecting'
  // Treat reconnecting like loading for the transport control (spinner).
  const isLoading = status.state === 'loading' || isReconnecting
  // While reconnecting, mpv may be momentarily gone — its controls would no-op,
  // so disable them rather than look broken.
  const controlsDisabled = isReconnecting
  const title = status.title ?? request.title ?? 'Lecture'
  const isError = status.state === 'error'

  const attempt = status.reconnectAttempt ?? 0
  const reconnectLabel =
    attempt >= 5
      ? `Reconnexion… (tentative ${attempt} — chaîne peut-être indisponible)`
      : attempt > 1
        ? `Reconnexion… (tentative ${attempt})`
        : 'Reconnexion…'

  const stateLabel = unavailable
    ? 'Lecteur indisponible'
    : isError
      ? 'Erreur'
      : isReconnecting
        ? reconnectLabel
        : status.state === 'loading'
          ? 'Préparation…'
          : status.state === 'paused'
            ? 'En pause'
            : status.state === 'ended'
              ? 'Terminé'
              : status.state === 'playing'
                ? 'En lecture'
                : ''

  const close = (): void => {
    void player.stop()
    onClose()
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 bg-surface-sunken px-4 py-2.5">
      {/* Title + state */}
      <div className="flex min-w-0 items-center gap-3" style={{ width: 220 }}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <IconFilm size={18} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-100" title={title}>
            {title}
          </p>
          <p
            className={cn(
              'text-xs',
              isError || unavailable
                ? 'text-red-300'
                : isReconnecting
                  ? 'text-amber-300'
                  : 'text-gray-500'
            )}
          >
            {stateLabel}
          </p>
        </div>
      </div>

      {isError || unavailable ? (
        <div className="flex flex-1 items-center justify-between gap-3">
          <p className="truncate text-xs text-red-300">
            {player.error ?? status.error ?? 'Lecture impossible.'}
          </p>
          <Button variant="ghost" size="sm" icon={<IconStop size={16} />} onClick={close}>
            Fermer
          </Button>
        </div>
      ) : (
        <>
          {/* Transport + seek */}
          <div className="flex min-w-[260px] flex-1 items-center gap-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void player.togglePlay()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
            >
              {isLoading ? <Spinner size={16} /> : isPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            {!isLive && (
              <span className="shrink-0 text-right text-xs tabular-nums text-gray-300">
                {formatClock(status.positionSecs, duration)}
              </span>
            )}
            <SeekBar
              positionSecs={status.positionSecs}
              bufferedSecs={status.bufferedSecs}
              durationSecs={duration}
              live={isLive}
              disabled={controlsDisabled || isLoading}
              onSeek={(secs) => void player.seek(secs)}
            />
            {!isLive && (
              <button
                type="button"
                onClick={() => toggleRemaining()}
                title={showRemaining ? 'Afficher la durée totale' : 'Afficher le temps restant'}
                className="shrink-0 text-xs tabular-nums text-gray-500 transition-colors hover:text-gray-200"
              >
                {duration > 0
                  ? showRemaining
                    ? formatClock(-(duration - status.positionSecs), duration)
                    : formatClock(duration, duration)
                  : '—'}
              </button>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void player.toggleMute()}
                className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
                aria-label={status.muted ? 'Réactiver le son' : 'Couper le son'}
              >
                {status.muted ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
              </button>
              <VolumeSlider
                volume={status.volume}
                muted={status.muted}
                disabled={controlsDisabled}
                onChange={(v) => void player.setVolume(v, false)}
              />
            </div>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void player.cycleSubtitle()}
              title="Sous-titres (piste suivante)"
              className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Changer de sous-titres"
            >
              <IconSubtitles size={18} />
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void player.cycleAudio()}
              title={`Piste audio${status.audioTrack ? ` : ${status.audioTrack}` : ''} — cliquer pour la suivante`}
              className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Changer de piste audio"
            >
              <IconAudioTrack size={18} />
            </button>
            {isLive && (
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void toggleRecord()}
                title={recording ? 'Arrêter l’enregistrement' : 'Enregistrer le direct'}
                aria-label={recording ? 'Arrêter l’enregistrement' : 'Enregistrer le direct'}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-40',
                  recording
                    ? 'animate-pulse bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'text-gray-300 hover:text-white'
                )}
              >
                <IconRecord size={14} />
                {recording ? 'REC' : ''}
              </button>
            )}
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void player.setFullscreen(!status.fullscreen)}
              title="Plein écran (fenêtre vidéo)"
              className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Plein écran"
            >
              <IconFullscreen size={18} />
            </button>
            <Button variant="ghost" size="sm" icon={<IconStop size={16} />} onClick={close}>
              Arrêter
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
