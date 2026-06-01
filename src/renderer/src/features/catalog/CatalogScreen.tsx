import { useState, type ReactElement } from 'react'
import type { VodCategory, VodStream } from '@shared/index'
import { api, unwrap } from '../../lib/ipc'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useDownloads } from '../../lib/downloads'
import {
  Button,
  TextInput,
  IconSearch,
  IconRefresh,
  IconFilm,
  LoadingState,
  EmptyState,
  ErrorState
} from '../../components/ui'
import { CategorySidebar } from './CategorySidebar'
import { PosterGrid } from './PosterGrid'
import { useStreamFeed } from './useStreamFeed'

type SortBy = 'name' | 'addedAt' | 'rating' | 'year'

const SORT_OPTIONS: { value: `${SortBy}:${'asc' | 'desc'}`; label: string }[] = [
  { value: 'addedAt:desc', label: 'Ajouts récents' },
  { value: 'name:asc', label: 'Titre (A→Z)' },
  { value: 'rating:desc', label: 'Mieux notés' },
  { value: 'year:desc', label: 'Plus récents' }
]

export function CatalogScreen({
  onSelectMovie,
  onGoToSettings
}: {
  onSelectMovie: (stream: VodStream) => void
  onGoToSettings: () => void
}): ReactElement {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [rawQuery, setRawQuery] = useState('')
  const query = useDebounced(rawQuery, 300)
  const [sort, setSort] = useState<`${SortBy}:${'asc' | 'desc'}`>('addedAt:desc')
  const [sortBy, sortDir] = sort.split(':') as [SortBy, 'asc' | 'desc']

  const { downloadedStreamIds } = useDownloads()

  const categoriesState = useAsync<VodCategory[]>(
    () => api().catalog.listCategories().then(unwrap),
    []
  )

  const feed = useStreamFeed({ categoryId, query, sortBy, sortDir })

  const isSearching = query.trim().length > 0
  const selectedCategoryName =
    categoryId == null
      ? 'Tous les films'
      : (categoriesState.data?.find((c) => c.categoryId === categoryId)?.categoryName ??
        'Catégorie')

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={categoriesState.data ?? []}
        loading={categoriesState.loading}
        error={categoriesState.error}
        selectedId={categoryId}
        onSelect={setCategoryId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <IconSearch size={16} />
            </span>
            <TextInput
              className="pl-9"
              placeholder="Rechercher un film…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            disabled={isSearching}
            className="h-10 rounded-lg border border-white/10 bg-surface-sunken px-3 text-sm text-gray-200 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/70 disabled:opacity-40"
            title={isSearching ? 'Tri indisponible pendant la recherche' : 'Trier'}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Header line */}
        <div className="flex items-center justify-between px-5 pt-3 text-sm text-gray-400">
          <span>
            {isSearching ? (
              <>
                Résultats pour « <span className="text-gray-200">{query.trim()}</span> »
              </>
            ) : (
              <span className="text-gray-200">{selectedCategoryName}</span>
            )}
            {!feed.loading && !feed.error && (
              <span className="ml-2 text-gray-600">· {feed.total} films</span>
            )}
          </span>
        </div>

        {/* Grid / states */}
        <div className="min-h-0 flex-1 px-4 pb-2 pt-2">
          {feed.loading ? (
            <LoadingState label="Chargement du catalogue…" />
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.reload} retryLabel="Réessayer" />
          ) : feed.items.length === 0 ? (
            isSearching ? (
              <EmptyState
                icon={<IconSearch size={36} />}
                title="Aucun résultat"
                description={`Aucun film ne correspond à « ${query.trim()} ». Essayez d’autres mots-clés.`}
              />
            ) : (
              <EmptyState
                icon={<IconFilm size={36} />}
                title="Catalogue vide"
                description="Le cache local est vide. Lancez un rafraîchissement du catalogue depuis les Réglages."
                action={
                  <Button
                    variant="primary"
                    icon={<IconRefresh size={16} />}
                    onClick={onGoToSettings}
                  >
                    Aller aux Réglages
                  </Button>
                }
              />
            )
          ) : (
            <PosterGrid
              items={feed.items}
              total={feed.total}
              loadingMore={feed.loadingMore}
              hasMore={feed.hasMore}
              onLoadMore={feed.loadMore}
              onSelect={onSelectMovie}
              downloadedStreamIds={downloadedStreamIds}
            />
          )}
        </div>
      </div>
    </div>
  )
}
