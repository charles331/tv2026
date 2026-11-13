/**
 * Global search: one field, results from the three catalogues at once (films,
 * séries, chaînes). Each section shows its first results and a "Tout voir"
 * button that opens the matching tab with the same query.
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import type { LiveStream, SeriesStream, VodStream } from '@shared/index'
import { api, unwrap } from '../../lib/ipc'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useDownloads } from '../../lib/downloads'
import { Button, TextInput, IconSearch, LoadingState, EmptyState, ErrorState } from '../../components/ui'
import { PosterCard } from '../catalog/PosterCard'
import { SeriesCard } from '../series/SeriesCard'
import { LiveChannelRow } from '../live/LiveChannelRow'
import { ChannelGuide } from '../live/ChannelGuide'

/** Where "Tout voir" can lead. */
export type SearchTarget = 'catalog' | 'series' | 'live'

const POSTERS_SHOWN = 12
const CHANNELS_SHOWN = 6
const MIN_QUERY = 2

interface Results {
  movies: { items: VodStream[]; total: number }
  series: { items: SeriesStream[]; total: number }
  channels: { items: LiveStream[]; total: number }
}

function Section({
  title,
  total,
  shown,
  onSeeAll,
  children
}: {
  title: string
  total: number
  shown: number
  onSeeAll: () => void
  children: ReactNode
}): ReactElement | null {
  if (total === 0) return null
  return (
    <section className="mb-7">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">
          {title} <span className="ml-1 font-normal text-gray-600">· {total}</span>
        </h2>
        {total > shown && (
          <Button size="sm" variant="ghost" onClick={onSeeAll}>
            Tout voir ({total})
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

export function SearchScreen({
  query: rawQuery,
  onQueryChange,
  onSelectMovie,
  onSelectSeries,
  onPlayChannel,
  onSeeAll
}: {
  /** Kept by the app so the search survives a detour to another tab. */
  query: string
  onQueryChange: (query: string) => void
  onSelectMovie: (stream: VodStream) => void
  onSelectSeries: (series: SeriesStream) => void
  onPlayChannel: (channel: LiveStream) => void
  onSeeAll: (target: SearchTarget, query: string) => void
}): ReactElement {
  const query = useDebounced(rawQuery, 300).trim()
  const [guideChannel, setGuideChannel] = useState<LiveStream | null>(null)
  const { downloadedStreamIds } = useDownloads()
  const active = query.length >= MIN_QUERY

  const results = useAsync<Results | null>(async () => {
    if (!active) return null
    const page = { query, categoryId: null, page: 1 }
    const [movies, series, channels] = await Promise.all([
      api().catalog.search({ ...page, pageSize: POSTERS_SHOWN, sortBy: 'addedAt', sortDir: 'desc' }),
      api().series.search({ ...page, pageSize: POSTERS_SHOWN, sortBy: 'lastModified', sortDir: 'desc' }),
      api().live.search({ ...page, pageSize: CHANNELS_SHOWN, sortBy: 'number', sortDir: 'asc' })
    ])
    return { movies: unwrap(movies), series: unwrap(series), channels: unwrap(channels) }
  }, [query, active])

  const data = active ? results.data : null
  const nothing =
    data != null && data.movies.total + data.series.total + data.channels.total === 0
  const posterGrid = 'grid gap-4'
  const posterColumns = { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <div className="relative max-w-xl flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
            <IconSearch size={16} />
          </span>
          <TextInput
            autoFocus
            className="pl-9"
            placeholder="Rechercher partout : films, séries, chaînes…"
            value={rawQuery}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!active ? (
          <EmptyState
            icon={<IconSearch size={36} />}
            title="Recherche globale"
            description="Tapez au moins deux lettres : les films, les séries et les chaînes sont cherchés en même temps. Les accents et l’ordre des mots n’ont pas d’importance."
          />
        ) : results.error ? (
          <ErrorState message={results.error} onRetry={results.reload} retryLabel="Réessayer" />
        ) : data == null ? (
          <LoadingState label="Recherche…" />
        ) : nothing ? (
          <EmptyState
            icon={<IconSearch size={36} />}
            title="Aucun résultat"
            description={`Rien ne correspond à « ${query} » dans les films, les séries ou les chaînes.`}
          />
        ) : (
          <div className={results.loading ? 'opacity-60' : ''}>
            <Section
              title="Films"
              total={data.movies.total}
              shown={data.movies.items.length}
              onSeeAll={() => onSeeAll('catalog', query)}
            >
              <div className={posterGrid} style={posterColumns}>
                {data.movies.items.map((m) => (
                  <PosterCard
                    key={m.streamId}
                    stream={m}
                    downloaded={downloadedStreamIds.has(m.streamId)}
                    onSelect={onSelectMovie}
                  />
                ))}
              </div>
            </Section>
            <Section
              title="Séries"
              total={data.series.total}
              shown={data.series.items.length}
              onSeeAll={() => onSeeAll('series', query)}
            >
              <div className={posterGrid} style={posterColumns}>
                {data.series.items.map((s) => (
                  <SeriesCard key={s.seriesId} series={s} onSelect={onSelectSeries} />
                ))}
              </div>
            </Section>
            <Section
              title="Chaînes"
              total={data.channels.total}
              shown={data.channels.items.length}
              onSeeAll={() => onSeeAll('live', query)}
            >
              <div className="space-y-2">
                {data.channels.items.map((c) => (
                  <LiveChannelRow
                    key={c.streamId}
                    channel={c}
                    onPlay={onPlayChannel}
                    onOpenGuide={setGuideChannel}
                  />
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>

      {guideChannel && (
        <ChannelGuide
          channel={guideChannel}
          onClose={() => setGuideChannel(null)}
          onPlay={(c) => {
            setGuideChannel(null)
            onPlayChannel(c)
          }}
        />
      )}
    </div>
  )
}
