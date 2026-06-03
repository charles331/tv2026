import { useState, type ReactElement } from 'react'
import type { FavoriteItem, SeriesCategory, SeriesStream, VodCategory } from '@shared/index'
import { api, unwrap } from '../../lib/ipc'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useFavorites, FAVORITES_CATEGORY_ID } from '../../lib/favorites'
import { FavoritesView } from '../favorites/FavoritesView'
import {
  Button,
  TextInput,
  IconSearch,
  IconRefresh,
  IconTv,
  LoadingState,
  EmptyState,
  ErrorState
} from '../../components/ui'
import { CategorySidebar } from '../catalog/CategorySidebar'
import { SeriesGrid } from './SeriesGrid'
import { useSeriesFeed } from './useSeriesFeed'

type SortBy = 'name' | 'lastModified' | 'rating' | 'year'

const SORT_OPTIONS: { value: `${SortBy}:${'asc' | 'desc'}`; label: string }[] = [
  { value: 'lastModified:desc', label: 'Récemment mises à jour' },
  { value: 'name:asc', label: 'Titre (A→Z)' },
  { value: 'rating:desc', label: 'Mieux notées' },
  { value: 'year:desc', label: 'Plus récentes' }
]

/** Adapt SeriesCategory[] to the (structurally compatible) sidebar shape. */
function toSidebarCategories(cats: SeriesCategory[]): VodCategory[] {
  return cats.map((c) => ({
    categoryId: c.categoryId,
    categoryName: c.categoryName,
    parentId: c.parentId,
    streamCount: c.seriesCount
  }))
}

/** Build a minimal SeriesStream from a favorite snapshot (to open the detail). */
function favToSeries(f: FavoriteItem): SeriesStream {
  return {
    seriesId: f.itemId,
    name: f.name,
    cover: f.image,
    rating: null,
    categoryId: f.categoryId ?? '',
    year: null,
    lastModified: null,
    plot: null,
    genre: null
  }
}

export function SeriesScreen({
  onSelectSeries,
  onGoToSettings
}: {
  onSelectSeries: (series: SeriesStream) => void
  onGoToSettings: () => void
}): ReactElement {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [rawQuery, setRawQuery] = useState('')
  const query = useDebounced(rawQuery, 300)
  const [sort, setSort] = useState<`${SortBy}:${'asc' | 'desc'}`>('lastModified:desc')
  const [sortBy, sortDir] = sort.split(':') as [SortBy, 'asc' | 'desc']

  const favorites = useFavorites()
  const isFavorites = categoryId === FAVORITES_CATEGORY_ID

  const categoriesState = useAsync<SeriesCategory[]>(
    () => api().series.listCategories().then(unwrap),
    []
  )

  const feed = useSeriesFeed({
    categoryId: isFavorites ? null : categoryId,
    query: isFavorites ? '' : query,
    sortBy,
    sortDir
  })

  const isSearching = query.trim().length > 0
  const selectedCategoryName =
    categoryId == null
      ? 'Toutes les séries'
      : (categoriesState.data?.find((c) => c.categoryId === categoryId)?.categoryName ??
        'Catégorie')

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={toSidebarCategories(categoriesState.data ?? [])}
        loading={categoriesState.loading}
        error={categoriesState.error}
        selectedId={categoryId}
        onSelect={setCategoryId}
        allLabel="Toutes les séries"
        favoritesCount={favorites.count('series')}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <IconSearch size={16} />
            </span>
            <TextInput
              className="pl-9"
              placeholder="Rechercher une série…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              disabled={isFavorites}
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            disabled={isSearching || isFavorites}
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

        <div className="flex items-center justify-between px-5 pt-3 text-sm text-gray-400">
          <span>
            {isFavorites ? (
              <>
                <span className="text-gray-200">★ Favoris</span>
                <span className="ml-2 text-gray-600">· {favorites.count('series')} séries</span>
              </>
            ) : isSearching ? (
              <>
                Résultats pour « <span className="text-gray-200">{query.trim()}</span> »
              </>
            ) : (
              <span className="text-gray-200">{selectedCategoryName}</span>
            )}
            {!isFavorites && !feed.loading && !feed.error && (
              <span className="ml-2 text-gray-600">· {feed.total} séries</span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 px-4 pb-2 pt-2">
          {isFavorites ? (
            <FavoritesView kind="series" onActivate={(f) => onSelectSeries(favToSeries(f))} />
          ) : feed.loading ? (
            <LoadingState label="Chargement des séries…" />
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.reload} retryLabel="Réessayer" />
          ) : feed.items.length === 0 ? (
            isSearching ? (
              <EmptyState
                icon={<IconSearch size={36} />}
                title="Aucun résultat"
                description={`Aucune série ne correspond à « ${query.trim()} ».`}
              />
            ) : (
              <EmptyState
                icon={<IconTv size={36} />}
                title="Aucune série"
                description="Le cache local est vide. Lancez un rafraîchissement des séries depuis les Réglages."
                action={
                  <Button variant="primary" icon={<IconRefresh size={16} />} onClick={onGoToSettings}>
                    Aller aux Réglages
                  </Button>
                }
              />
            )
          ) : (
            <SeriesGrid
              items={feed.items}
              total={feed.total}
              loadingMore={feed.loadingMore}
              hasMore={feed.hasMore}
              onLoadMore={feed.loadMore}
              onSelect={onSelectSeries}
            />
          )}
        </div>
      </div>
    </div>
  )
}
