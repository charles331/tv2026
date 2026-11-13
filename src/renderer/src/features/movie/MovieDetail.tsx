import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { FileCheckResult, VodInfo, VodStream } from '@shared/index'
import { detectLowQualityTag, fileQuality, resumeStart } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'
import { publishFileCheck } from '../../lib/fileChecks'
import { useDownloads } from '../../lib/downloads'
import { useProgress } from '../../lib/progress'
import {
  Button,
  Badge,
  Poster,
  Spinner,
  ErrorState,
  IconDownload,
  IconPlay,
  IconStar,
  IconExternal,
  IconX,
  IconCheck
} from '../../components/ui'
import { formatBytes, formatClock, formatDuration, formatRating, trailerUrl } from '../../lib/format'
import { FavoriteButton } from '../favorites/FavoriteButton'
import { FileQualityPill, LowQualityTag, formatMbps, type FilePillState } from './quality'

/**
 * Movie detail overlay. Loads full info via `catalog.getInfo` and offers
 * Télécharger / Lire actions. `onPlay` is delegated to the app shell so the
 * player chrome can take over (mpv surface arrives later).
 */
export function MovieDetail({
  stream,
  onClose,
  onPlay
}: {
  stream: VodStream
  onClose: () => void
  /** `fromStart` ignores the saved position (default: resume). */
  onPlay: (stream: VodStream, info: VodInfo | null, fromStart?: boolean) => void
}): ReactElement {
  const { add, downloadedStreamIds, items } = useDownloads()
  const progressStore = useProgress()
  const watchProgress = progressStore.get('movie', stream.streamId)
  const resumeAt = resumeStart(watchProgress)
  const [info, setInfo] = useState<VodInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const alreadyQueued = downloadedStreamIds.has(stream.streamId)
  // Strong signal that a local file exists -> "Lire" will play offline (the
  // backend confirms file presence via downloads.localPath at play time).
  const completedLocally = items.some(
    (it) => it.streamId === stream.streamId && it.status === 'completed'
  )

  // --- file quality (real size via a 1-byte request, see main/quality) ---
  const [fileState, setFileState] = useState<FilePillState>({ kind: 'checking' })
  const [confirmLowQuality, setConfirmLowQuality] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const checkFile = useCallback(
    (manual: boolean) => {
      setFileState({ kind: 'checking' })
      api()
        .catalog.checkFile(stream.streamId, manual)
        .then((r) => {
          const res = unwrap(r)
          if (res.status === 'ok') publishFileCheck(stream.streamId, res)
          setFileState(toPillState(res))
        })
        .catch((e) => setFileState({ kind: 'error', message: describeError(e) }))
    },
    [stream.streamId]
  )

  // "Analyser": real resolution + codec (mpv reads the first frame, a few seconds).
  const analyzeFile = useCallback(() => {
    setAnalyzing(true)
    setAnalyzeError(null)
    api()
      .catalog.analyzeFile(stream.streamId)
      .then((r) => {
        const res = unwrap(r)
        if (res.status === 'ok') {
          publishFileCheck(stream.streamId, res)
          setFileState(toPillState(res))
        } else if (res.status === 'busy')
          setAnalyzeError('connexion occupée par un téléchargement ou une lecture')
        else if (res.status === 'error') setAnalyzeError(res.message)
      })
      .catch((e) => setAnalyzeError(describeError(e)))
      .finally(() => setAnalyzing(false))
  }, [stream.streamId])

  useEffect(() => {
    checkFile(false)
  }, [checkFile])

  // The connection was busy: check again on the next RELEASE signal from the
  // lock. (Not from useConnectionBusy: it starts at "idle" and only learns the
  // real state on the next change, so a page opened during playback would
  // believe the connection free and retry in a loop.)
  useEffect(() => {
    if (fileState.kind !== 'busy') return
    return api().connectionLock.onBusyChange((e) => {
      if (!e.busy) checkFile(false)
    })
  }, [fileState.kind, checkFile])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api()
      .catalog.getInfo(stream.streamId)
      .then((r) => setInfo(unwrap(r)))
      .catch((e) => setError(describeError(e)))
      .finally(() => setLoading(false))
  }, [stream.streamId])

  useEffect(() => {
    load()
  }, [load])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lowQualityTag = detectLowQualityTag(stream.name) ?? detectLowQualityTag(info?.name)
  const fileVerdict =
    fileState.kind === 'ok'
      ? fileQuality(fileState.sizeBytes, fileState.durationSecs ?? info?.durationSecs, fileState.video)
      : null
  const suspect = lowQualityTag !== null || fileVerdict?.level === 'low'

  const handleDownload = useCallback(async () => {
    setConfirmLowQuality(false)
    setAdding(true)
    setActionError(null)
    setActionMessage(null)
    try {
      await add({
        streamId: stream.streamId,
        name: info?.name ?? stream.name,
        containerExtension: info?.containerExtension ?? stream.containerExtension
      })
      setActionMessage('Ajouté à la file de téléchargement.')
    } catch (e) {
      setActionError(describeError(e))
    } finally {
      setAdding(false)
    }
  }, [add, info, stream])

  const title = info?.title || info?.name || stream.name
  const year = info?.year ?? stream.year
  const rating = info?.rating ?? stream.rating
  const tmdbRating = info?.tmdbRating ?? null
  const tmdbVotes = info?.tmdbVoteCount ?? null
  const imdbId = info?.imdbId ?? null
  const poster = info?.posterUrl ?? stream.streamIcon
  const backdrop = info?.backdropUrls?.[0] ?? null
  const trailer = trailerUrl(info?.trailer)

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/70 p-0 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fade-in relative h-full w-full max-w-4xl overflow-hidden rounded-none bg-surface-raised shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Backdrop banner */}
        <div className="relative h-44 w-full overflow-hidden sm:h-56">
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              className="h-full w-full object-cover opacity-60"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-surface-overlay to-surface" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-raised via-surface-raised/40 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
            aria-label="Fermer"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-14rem)] overflow-y-auto p-5 sm:p-6">
          <div className="-mt-20 flex gap-5">
            <div className="hidden w-32 shrink-0 sm:block">
              <div className="aspect-[2/3] overflow-hidden rounded-lg shadow-poster ring-1 ring-white/10">
                <Poster src={poster} alt={title} className="h-full w-full" />
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-16 sm:pt-20">
              <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-400">
                {year != null && <span>{year}</span>}
                <button
                  type="button"
                  onClick={() =>
                    void progressStore.setWatched({
                      kind: 'movie',
                      itemId: stream.streamId,
                      watched: !watchProgress?.watched,
                      name: title,
                      image: poster,
                      containerExtension: info?.containerExtension ?? stream.containerExtension
                    })
                  }
                  title={watchProgress?.watched ? 'Marquer comme non vu' : 'Marquer comme vu'}
                  className={
                    'rounded-full px-2 py-0.5 text-xs transition-colors ' +
                    (watchProgress?.watched
                      ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      : 'text-gray-500 hover:bg-white/[0.08] hover:text-gray-200')
                  }
                >
                  {watchProgress?.watched ? '✓ Vu' : 'Marquer comme vu'}
                </button>
                {rating != null && rating > 0 && (
                  <span
                    className="flex items-center gap-1 text-amber-300"
                    title="Note du fournisseur IPTV"
                  >
                    <IconStar size={13} /> {formatRating(rating)}
                    <span className="text-[10px] font-semibold text-amber-300/60">fournisseur</span>
                  </span>
                )}
                {tmdbRating != null && tmdbRating > 0 && (
                  <span
                    className="flex items-center gap-1 text-amber-300"
                    title={
                      tmdbVotes != null
                        ? `Note TMDB — ${tmdbVotes.toLocaleString('fr-FR')} votes`
                        : 'Note TMDB'
                    }
                  >
                    <IconStar size={13} /> {formatRating(tmdbRating)}
                    <span className="text-[10px] font-semibold text-amber-300/70">TMDB</span>
                  </span>
                )}
                {imdbId && (
                  <a
                    href={`https://www.imdb.com/title/${imdbId}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-[#f5c518]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#f5c518] transition-colors hover:bg-[#f5c518]/25"
                    title="Voir sur IMDb"
                  >
                    IMDb <IconExternal size={11} />
                  </a>
                )}
                {info?.durationSecs != null && info.durationSecs > 0 && (
                  <span>{formatDuration(info.durationSecs)}</span>
                )}
                <LowQualityTag name={`${stream.name} ${info?.name ?? ''}`} />
                {alreadyQueued && (
                  <Badge tone="success">
                    <IconCheck size={11} /> Dans la file / téléchargé
                  </Badge>
                )}
              </div>

              <div className="mt-2">
                <FileQualityPill
                  state={
                    fileState.kind === 'ok' && fileState.durationSecs == null
                      ? { ...fileState, durationSecs: info?.durationSecs ?? null }
                      : fileState
                  }
                  onCheck={() => checkFile(true)}
                  onAnalyze={analyzeFile}
                  analyzing={analyzing}
                  analyzeError={analyzeError}
                />
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  icon={<IconPlay size={18} />}
                  onClick={() => onPlay(stream, info)}
                  title={
                    completedLocally
                      ? 'Lecture du fichier local (hors-ligne)'
                      : 'Lecture en streaming'
                  }
                >
                  {resumeAt != null
                    ? `Reprendre à ${formatClock(watchProgress?.positionSecs)}`
                    : completedLocally
                      ? 'Lire (hors-ligne)'
                      : 'Lire'}
                </Button>
                {resumeAt != null && (
                  <Button variant="ghost" size="lg" onClick={() => onPlay(stream, info, true)}>
                    Depuis le début
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<IconDownload size={18} />}
                  loading={adding}
                  onClick={() => (suspect ? setConfirmLowQuality(true) : void handleDownload())}
                  title={suspect ? 'Copie probablement de mauvaise qualité' : undefined}
                  className={suspect ? 'ring-1 ring-red-400/40' : undefined}
                >
                  Télécharger
                  {suspect && (
                    <span className="ml-1 rounded bg-red-500/80 px-1 text-[10px] font-bold text-white">
                      !
                    </span>
                  )}
                </Button>
                <FavoriteButton
                  size="lg"
                  req={{
                    kind: 'movie',
                    itemId: stream.streamId,
                    name: title,
                    image: poster,
                    containerExtension: info?.containerExtension ?? stream.containerExtension,
                    categoryId: stream.categoryId
                  }}
                />
                {trailer && (
                  <a
                    href={trailer}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center gap-2 rounded-lg px-4 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <IconExternal size={16} /> Bande-annonce
                  </a>
                )}
              </div>
              {actionError && <p className="mt-2 text-sm text-red-300">{actionError}</p>}
              {actionMessage && <p className="mt-2 text-sm text-emerald-300">{actionMessage}</p>}
            </div>
          </div>

          {/* Details */}
          <div className="mt-6">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
                <Spinner size={16} /> Chargement des détails…
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={load} className="py-8" />
            ) : info ? (
              <div className="space-y-4">
                {info.genre && (
                  <div className="flex flex-wrap gap-2">
                    {info.genre.split(/[,/]/).map((g, i) => {
                      const label = g.trim()
                      return label ? (
                        <Badge key={i} tone="neutral">
                          {label}
                        </Badge>
                      ) : null
                    })}
                  </div>
                )}
                {info.plot && <p className="text-sm leading-relaxed text-gray-300">{info.plot}</p>}
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {info.director && <Detail label="Réalisation" value={info.director} />}
                  {info.cast && <Detail label="Casting" value={info.cast} />}
                </dl>
              </div>
            ) : (
              <p className="py-6 text-sm text-gray-500">Aucun détail disponible.</p>
            )}
          </div>
        </div>

        {confirmLowQuality && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setConfirmLowQuality(false)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              className="w-full max-w-md rounded-xl bg-surface-overlay p-5 shadow-2xl ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-lg font-bold text-red-300">
                  !
                </div>
                <div>
                  <h3 className="font-semibold text-white">Copie probablement de mauvaise qualité</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    « {title} »{' '}
                    {lowQualityTag && (
                      <>
                        est marqué <b className="text-red-300">{lowQualityTag}</b>
                        {fileVerdict ? ' et ' : '.'}
                      </>
                    )}
                    {fileVerdict && fileState.kind === 'ok' && (
                      <>
                        ne pèse que{' '}
                        <b className="text-gray-200">
                          {formatBytes(fileState.sizeBytes)} pour{' '}
                          {formatDuration(fileState.durationSecs ?? info?.durationSecs)}
                        </b>{' '}
                        (≈ {formatMbps(fileVerdict.mbps)}). Une copie normale en 1080p fait plutôt 2 à 5 Go.
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmLowQuality(false)}>
                  Annuler
                </Button>
                <Button variant="danger" onClick={() => void handleDownload()}>
                  Télécharger quand même
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function toPillState(res: FileCheckResult): FilePillState {
  if (res.status === 'ok') {
    return { kind: 'ok', sizeBytes: res.sizeBytes, durationSecs: res.durationSecs, video: res.video }
  }
  return res.status === 'error' ? { kind: 'error', message: res.message } : { kind: res.status }
}

function Detail({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-300">{value}</dd>
    </div>
  )
}
