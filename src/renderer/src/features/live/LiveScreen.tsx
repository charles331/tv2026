import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { FavoriteItem, LiveCategory, LiveStream, VodCategory } from '@shared/index'
import { api, unwrap } from '../../lib/ipc'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useFavorites, FAVORITES_CATEGORY_ID } from '../../lib/favorites'
import { FavoritesView } from '../favorites/FavoritesView'
import {
  Button,
  TextInput,
  IconSearch,
  IconRefresh,
  IconBroadcast,
  LoadingState,
  EmptyState,
  ErrorState
} from '../../components/ui'
import { CategorySidebar } from '../catalog/CategorySidebar'
import { LiveChannelRow } from './LiveChannelRow'
import { ChannelGuide } from './ChannelGuide'
import { useLiveFeed } from './useLiveFeed'

/** Adapt LiveCategory[] to the (structurally compatible) sidebar shape. */
function toSidebarCategories(cats: LiveCategory[]): VodCategory[] {
  return cats.map((c) => ({
    categoryId: c.categoryId,
    categoryName: c.categoryName,
    parentId: c.parentId,
    streamCount: c.channelCount
  }))
}

/** Build a minimal LiveStream from a favorite snapshot (to play it). */
function favToLive(f: FavoriteItem): LiveStream {
  return {
    streamId: f.itemId,
    name: f.name,
    icon: f.image,
    number: null,
    epgChannelId: null,
    categoryId: f.categoryId ?? '',
    hasArchive: false
  }
}

export function LiveScreen({
  onPlayChannel,
  onGoToSettings
}: {
  onPlayChannel: (channel: LiveStream) => void
  onGoToSettings: () => void
}): ReactElement {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [rawQuery, setRawQuery] = useState('')
  const [guideChannel, setGuideChannel] = useState<LiveStream | null>(null)
  const query = useDebounced(rawQuery, 300)

  const favorites = useFavorites()
  const isFavorites = categoryId === FAVORITES_CATEGORY_ID

  const categoriesState = useAsync<LiveCategory[]>(() => api().live.listCategories().then(unwrap), [])
  const feed = useLiveFeed({
    categoryId: isFavorites ? null : categoryId,
    query: isFavorites ? '' : query,
    sortBy: 'number',
    sortDir: 'asc'
  })

  const isSearching = query.trim().length > 0
  const selectedCategoryName =
    categoryId == null
      ? 'Toutes les chaînes'
      : (categoriesState.data?.find((c) => c.categoryId === categoryId)?.categoryName ?? 'Catégorie')

  // Sentinel-based infinite scroll.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { hasMore, loadingMore, loadMore } = feed
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loadingMore) loadMore()
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadingMore, loadMore])

  return (
    <div className="flex h-full">
      <CategorySidebar
        categories={toSidebarCategories(categoriesState.data ?? [])}
        loading={categoriesState.loading}
        error={categoriesState.error}
        selectedId={categoryId}
        onSelect={setCategoryId}
        allLabel="Toutes les chaînes"
        favoritesCount={favorites.count('live')}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <IconSearch size={16} />
            </span>
            <TextInput
              className="pl-9"
              placeholder="Rechercher une chaîne…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              disabled={isFavorites}
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pt-3 text-sm text-gray-400">
          <span>
            {isFavorites ? (
              <>
                <span className="text-gray-200">★ Favoris</span>
                <span className="ml-2 text-gray-600">· {favorites.count('live')} chaînes</span>
              </>
            ) : isSearching ? (
              <>
                Résultats pour « <span className="text-gray-200">{query.trim()}</span> »
              </>
            ) : (
              <span className="text-gray-200">{selectedCategoryName}</span>
            )}
            {!isFavorites && !feed.loading && !feed.error && (
              <span className="ml-2 text-gray-600">· {feed.total} chaînes</span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-2">
          {isFavorites ? (
            <FavoritesView kind="live" onActivate={(f) => onPlayChannel(favToLive(f))} />
          ) : feed.loading ? (
            <LoadingState label="Chargement des chaînes…" />
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.reload} retryLabel="Réessayer" />
          ) : feed.items.length === 0 ? (
            isSearching ? (
              <EmptyState
                icon={<IconSearch size={36} />}
                title="Aucun résultat"
                description={`Aucune chaîne ne correspond à « ${query.trim()} ».`}
              />
            ) : (
              <EmptyState
                icon={<IconBroadcast size={36} />}
                title="Aucune chaîne"
                description="Le cache local est vide. Lancez un rafraîchissement du direct depuis les Réglages."
                action={
                  <Button variant="primary" icon={<IconRefresh size={16} />} onClick={onGoToSettings}>
                    Aller aux Réglages
                  </Button>
                }
              />
            )
          ) : (
            <div className="space-y-2">
              {feed.items.map((c) => (
                <LiveChannelRow
                  key={c.streamId}
                  channel={c}
                  onPlay={onPlayChannel}
                  onOpenGuide={setGuideChannel}
                />
              ))}
              <div ref={sentinelRef} />
              {feed.loadingMore && (
                <div className="py-3 text-center text-xs text-gray-500">Chargement…</div>
              )}
            </div>
          )}
        </div>
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
