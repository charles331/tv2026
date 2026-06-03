import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Episode, SeriesInfo, SeriesStream } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'
import { useDownloads } from '../../lib/downloads'
import {
  Badge,
  Button,
  Poster,
  Spinner,
  ErrorState,
  IconDownload,
  IconPlay,
  IconStar,
  IconX,
  IconCheck
} from '../../components/ui'
import { formatDuration, formatRating } from '../../lib/format'
import { FavoriteButton } from '../favorites/FavoriteButton'

/** "S01E04" tag from a season/episode pair. */
function tag(season: number, episodeNum: number): string {
  const p = (n: number): string => n.toString().padStart(2, '0')
  return `S${p(season)}E${p(episodeNum)}`
}

export function SeriesDetail({
  series,
  onClose,
  onPlayEpisode
}: {
  series: SeriesStream
  onClose: () => void
  onPlayEpisode: (episode: Episode, seriesName: string) => void
}): ReactElement {
  const { add, downloadedStreamIds } = useDownloads()
  const [info, setInfo] = useState<SeriesInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyEpisodeId, setBusyEpisodeId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api()
      .series.getInfo(series.seriesId)
      .then((r) => {
        const data = unwrap(r)
        setInfo(data)
        setSelectedSeason(data.seasons[0]?.seasonNumber ?? null)
      })
      .catch((e) => setError(describeError(e)))
      .finally(() => setLoading(false))
  }, [series.seriesId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = info?.name || series.name
  const rating = info?.rating ?? series.rating
  const poster = info?.cover ?? series.cover
  const backdrop = info?.backdropUrls?.[0] ?? null
  const season = useMemo(
    () => info?.seasons.find((s) => s.seasonNumber === selectedSeason) ?? null,
    [info, selectedSeason]
  )

  const handleDownloadEpisode = useCallback(
    async (ep: Episode) => {
      setBusyEpisodeId(ep.episodeId)
      setActionError(null)
      try {
        await add({
          streamId: ep.episodeId,
          kind: 'series',
          name: `${title} ${tag(ep.season, ep.episodeNum)}`,
          containerExtension: ep.containerExtension
        })
      } catch (e) {
        setActionError(describeError(e))
      } finally {
        setBusyEpisodeId(null)
      }
    },
    [add, title]
  )

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
        <div className="relative h-44 w-full overflow-hidden sm:h-56">
          {backdrop ? (
            <img src={backdrop} alt="" className="h-full w-full object-cover opacity-60" loading="lazy" />
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
                {(info?.year ?? series.year) != null && <span>{info?.year ?? series.year}</span>}
                {rating != null && rating > 0 && (
                  <span className="flex items-center gap-1 text-amber-300" title="Note du fournisseur">
                    <IconStar size={13} /> {formatRating(rating)}
                  </span>
                )}
                {info?.genre && <span>{info.genre}</span>}
              </div>
              <div className="mt-4">
                <FavoriteButton
                  size="md"
                  req={{
                    kind: 'series',
                    itemId: series.seriesId,
                    name: title,
                    image: poster,
                    containerExtension: null,
                    categoryId: series.categoryId
                  }}
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-10 text-gray-400">
              <Spinner size={16} /> Chargement des épisodes…
            </div>
          ) : error ? (
            <div className="py-8">
              <ErrorState message={error} onRetry={load} retryLabel="Réessayer" />
            </div>
          ) : (
            <>
              {info?.plot && <p className="mt-4 text-sm leading-relaxed text-gray-300">{info.plot}</p>}

              {actionError && <p className="mt-3 text-sm text-red-300">{actionError}</p>}

              {/* Season selector */}
              {info && info.seasons.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {info.seasons.map((s) => (
                    <button
                      key={s.seasonNumber}
                      type="button"
                      onClick={() => setSelectedSeason(s.seasonNumber)}
                      className={
                        'rounded-lg px-3 py-1.5 text-sm transition-colors ' +
                        (s.seasonNumber === selectedSeason
                          ? 'bg-accent/20 font-medium text-accent-hover'
                          : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]')
                      }
                    >
                      Saison {s.seasonNumber}
                    </button>
                  ))}
                </div>
              )}

              {/* Episodes */}
              <ul className="mt-4 space-y-2">
                {(season?.episodes ?? []).map((ep) => {
                  const inQueue = downloadedStreamIds.has(ep.episodeId)
                  return (
                    <li
                      key={ep.episodeId}
                      className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface-sunken p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-100">
                          <span className="text-gray-500">{tag(ep.season, ep.episodeNum)}</span>{' '}
                          {ep.title}
                        </p>
                        {ep.durationSecs != null && ep.durationSecs > 0 && (
                          <p className="text-xs text-gray-500">{formatDuration(ep.durationSecs)}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<IconPlay size={14} />}
                        onClick={() => onPlayEpisode(ep, title)}
                      >
                        Lire
                      </Button>
                      {inQueue ? (
                        <Badge tone="success">
                          <IconCheck size={11} /> File / téléchargé
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<IconDownload size={14} />}
                          loading={busyEpisodeId === ep.episodeId}
                          onClick={() => handleDownloadEpisode(ep)}
                        >
                          Télécharger
                        </Button>
                      )}
                    </li>
                  )
                })}
                {season && season.episodes.length === 0 && (
                  <li className="py-6 text-center text-sm text-gray-500">
                    Aucun épisode dans cette saison.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
