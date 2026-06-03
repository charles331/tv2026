import { useEffect, useState, type ReactElement } from 'react'
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
  IconFilm
} from '../../components/ui'
import { formatDuration } from '../../lib/format'
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
  const { status, unavailable } = player
  const [seekPreview, setSeekPreview] = useState<number | null>(null)

  // Kick off playback when the requested source changes; stop on unmount.
  useEffect(() => {
    void player.play(request)
    return () => {
      void player.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.kind, request.streamId, request.filePath])

  const duration = status.durationSecs ?? 0
  const position = seekPreview ?? status.positionSecs
  const isPlaying = status.state === 'playing'
  const isLoading = status.state === 'loading'
  const title = status.title ?? request.title ?? 'Lecture'
  const isError = status.state === 'error'

  const stateLabel = unavailable
    ? 'Lecteur indisponible'
    : isError
      ? 'Erreur'
      : isLoading
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
          <p className={cn('text-xs', isError || unavailable ? 'text-red-300' : 'text-gray-500')}>
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
            <span className="w-12 text-right text-xs tabular-nums text-gray-400">
              {formatDuration(position)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              step={1}
              value={Math.min(position, duration || position)}
              disabled={duration <= 0}
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
              aria-label="Position"
            />
            <span className="w-12 text-xs tabular-nums text-gray-400">
              {duration > 0 ? formatDuration(duration) : '—'}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void player.toggleMute()}
                className="text-gray-300 transition-colors hover:text-white"
                aria-label={status.muted ? 'Réactiver le son' : 'Couper le son'}
              >
                {status.muted ? <IconVolumeMute size={18} /> : <IconVolume size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={status.muted ? 0 : status.volume}
                onChange={(e) => void player.setVolume(Number(e.target.value), false)}
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/15 accent-accent"
                aria-label="Volume"
              />
            </div>
            <button
              type="button"
              onClick={() => void player.cycleSubtitle()}
              title="Sous-titres (piste suivante)"
              className="text-gray-300 transition-colors hover:text-white"
              aria-label="Changer de sous-titres"
            >
              <IconSubtitles size={18} />
            </button>
            <button
              type="button"
              onClick={() => void player.cycleAudio()}
              title="Piste audio suivante"
              className="text-xs font-semibold text-gray-300 transition-colors hover:text-white"
              aria-label="Changer de piste audio"
            >
              AUD
            </button>
            <button
              type="button"
              onClick={() => void player.setFullscreen(!status.fullscreen)}
              title="Plein écran (fenêtre vidéo)"
              className="text-gray-300 transition-colors hover:text-white"
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
