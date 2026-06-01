import { useEffect, useState, type ReactElement } from 'react'
import type { PlayRequest } from '@shared/index'
import {
  Button,
  Spinner,
  IconPlay,
  IconPause,
  IconStop,
  IconVolume,
  IconVolumeMute,
  IconFullscreen,
  IconSubtitles,
  IconChevronLeft,
  IconFilm
} from '../../components/ui'
import { formatDuration } from '../../lib/format'
import { usePlayer } from './usePlayer'

/**
 * Player chrome: the transport controls for the mpv player.
 *
 * mpv renders the video in its OWN dedicated window (embedding into the Electron
 * window via --wid is unreliable — Chromium repaints over it → black video).
 * So the in-app surface is NOT a video frame: it shows a "lecture en cours dans
 * la fenêtre vidéo" state, while these controls drive mpv over IPC
 * (play/pause/seek/volume/fullscreen + subtitle & audio track cycling). The same
 * actions are also available directly in the mpv window (right-click / f, j, #).
 */
export function PlayerView({
  request,
  onClose
}: {
  request: PlayRequest
  onClose: () => void
}): ReactElement {
  const player = usePlayer()
  const { status, unavailable } = player
  const [seekPreview, setSeekPreview] = useState<number | null>(null)

  // Kick off playback when the requested source changes.
  useEffect(() => {
    void player.play(request)
    return () => {
      void player.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.kind, request.streamId, request.filePath])

  // Escape closes the player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') {
        e.preventDefault()
        void player.togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, player])

  const duration = status.durationSecs ?? 0
  const position = seekPreview ?? status.positionSecs
  const isPlaying = status.state === 'playing'
  const isLoading = status.state === 'loading'
  const title = status.title ?? request.title ?? 'Lecture'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <Button variant="ghost" size="sm" icon={<IconChevronLeft size={18} />} onClick={onClose}>
          Retour
        </Button>
        <h2 className="truncate text-sm font-medium text-gray-200">{title}</h2>
      </div>

      {/* Surface area — mpv renders in its own window, so this is informational,
          NOT a video frame. */}
      <div className="relative flex flex-1 items-center justify-center">
        <div id="mpv-surface" className="absolute inset-0" />
        {status.state === 'error' ? (
          <div className="max-w-sm text-center">
            <p className="text-base font-medium text-red-300">Erreur de lecture</p>
            <p className="mt-1 text-sm text-gray-400">{player.error ?? status.error}</p>
          </div>
        ) : unavailable ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-gray-400">
              <IconPlay size={26} />
            </div>
            <div>
              <p className="text-base font-medium text-gray-200">Lecteur indisponible</p>
              <p className="mt-1 max-w-sm text-sm text-gray-500">
                Le moteur de lecture mpv n’est pas disponible. Vérifiez que mpv est bien installé
                avec l’application.
              </p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <Spinner size={32} />
            <p className="text-sm text-gray-400">Préparation de la lecture…</p>
          </div>
        ) : status.state === 'idle' ? (
          <div className="flex flex-col items-center gap-4 text-center text-gray-400">
            <IconFilm size={40} />
            <p className="text-sm">Aucune lecture en cours.</p>
          </div>
        ) : (
          /* playing / paused / ended — video is in mpv's own window */
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
              <IconFilm size={30} />
            </div>
            <div>
              <p className="text-base font-medium text-gray-100">
                {status.state === 'paused'
                  ? 'En pause'
                  : status.state === 'ended'
                    ? 'Lecture terminée'
                    : 'Lecture en cours dans la fenêtre vidéo'}
              </p>
              <p className="mt-1 truncate text-sm text-gray-400">{title}</p>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">
                La vidéo s’affiche dans une fenêtre dédiée. Utilisez les contrôles ci-dessous, ou
                directement dans la fenêtre vidéo : <span className="text-gray-400">f</span> plein
                écran, <span className="text-gray-400">j</span> sous-titres,{' '}
                <span className="text-gray-400">#</span> piste audio, clic droit pour le menu.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gradient-to-t from-black/90 to-transparent px-6 pb-5 pt-8">
        {/* Seek bar */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="w-14 text-right tabular-nums">{formatDuration(position)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(position, duration || position)}
            disabled={unavailable || duration <= 0}
            onChange={(e) => setSeekPreview(Number(e.target.value))}
            onMouseUp={() => {
              if (seekPreview != null) {
                void player.seek(seekPreview)
                setSeekPreview(null)
              }
            }}
            onTouchEnd={() => {
              if (seekPreview != null) {
                void player.seek(seekPreview)
                setSeekPreview(null)
              }
            }}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-accent disabled:opacity-40"
          />
          <span className="w-14 tabular-nums">{duration > 0 ? formatDuration(duration) : '—'}</span>
        </div>

        {/* Transport */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={unavailable}
              onClick={() => void player.togglePlay()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              aria-label={isPlaying ? 'Pause' : 'Lecture'}
            >
              {isPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconStop size={16} />}
              disabled={unavailable}
              onClick={() => {
                void player.stop()
                onClose()
              }}
            >
              Arrêter
            </Button>
          </div>

          <div className="flex items-center gap-4">
            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={unavailable}
                onClick={() => void player.toggleMute()}
                className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
                aria-label={status.muted ? 'Réactiver le son' : 'Couper le son'}
              >
                {status.muted ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={status.muted ? 0 : status.volume}
                disabled={unavailable}
                onChange={(e) => void player.setVolume(Number(e.target.value), false)}
                className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-accent disabled:opacity-40"
                aria-label="Volume"
              />
            </div>

            <button
              type="button"
              disabled={unavailable}
              onClick={() => void player.cycleSubtitle()}
              title="Sous-titres (piste suivante)"
              className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Changer de sous-titres"
            >
              <IconSubtitles size={18} />
            </button>
            <button
              type="button"
              disabled={unavailable}
              onClick={() => void player.cycleAudio()}
              title="Piste audio suivante"
              className="text-xs font-semibold text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Changer de piste audio"
            >
              AUD
            </button>
            <button
              type="button"
              disabled={unavailable}
              onClick={() => void player.setFullscreen(!status.fullscreen)}
              title="Plein écran (fenêtre vidéo)"
              className="text-gray-300 transition-colors hover:text-white disabled:opacity-40"
              aria-label="Plein écran"
            >
              <IconFullscreen size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
