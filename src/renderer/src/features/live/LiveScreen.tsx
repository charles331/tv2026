import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { FavoriteItem, LiveCategory, LiveStream, VodCategory, WatchProgress } from '@shared/index'
import { api, unwrap } from '../../lib/ipc'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useFavorites, FAVORITES_CATEGORY_ID } from '../../lib/favorites'
import { FavoritesView } from '../favorites/FavoritesView'
import { useProgress, RECENT_CATEGORY_ID } from '../../lib/progress'
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
import { GuideSearchResults } from './GuideSearchResults'

const GUIDE_SEARCH_KEY = 'tv2026.live.searchGuides'
function readGuideSearchPref(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEARCH_KEY) === '1'
  } catch {
    return false
  }
}

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

/** Build a minimal LiveStream from a recently watched channel's snapshot. */
function recentToLive(p: WatchProgress): LiveStream {
  return {
    streamId: p.itemId,
    name: p.name,
    icon: p.image,
    number: null,
    epgChannelId: null,
    categoryId: '',
    hasArchive: false
  }
}

export function LiveScreen({
  onPlayChannel,
  onGoToSettings,
  initialQuery = ''
}: {
  onPlayChannel: (channel: LiveStream) => void
  onGoToSettings: () => void
  /** Query to start with ("Tout voir" from the global search). */
  initialQuery?: string
}): ReactElement {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [rawQuery, setRawQuery] = useState(initialQuery)
  const [guideChannel, setGuideChannel] = useState<LiveStream | null>(null)
  const [searchGuides, setSearchGuides] = useState(readGuideSearchPref)
  const query = useDebounced(rawQuery, 300)
  const toggleSearchGuides = (on: boolean): void => {
    setSearchGuides(on)
    try {
      localStorage.setItem(GUIDE_SEARCH_KEY, on ? '1' : '0')
    } catch {
      // preference only; ignore storage failures
    }
  }

  const favorites = useFavorites()
  const isFavorites = categoryId === FAVORITES_CATEGORY_ID
  // "Récentes": the channels watched lately, most recent first. Like Favoris,
  // a list of its own (no catalogue query, no search).
  const recentChannels = useProgress().recentChannels
  const isRecent = categoryId === RECENT_CATEGORY_ID
  const isPinned = isFavorites || isRecent

  const categoriesState = useAsync<LiveCategory[]>(() => api().live.listCategories().then(unwrap), [])
  const feed = useLiveFeed({
    categoryId: isPinned ? null : categoryId,
    query: isPinned ? '' : query,
    sortBy: 'number',
    sortDir: 'asc'
  })

  const isSearching = query.trim().length > 0
  // Programme search needs a couple of characters to stay meaningful.
  const showGuideResults = searchGuides && !isPinned && query.trim().length >= 2
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
        pinned={
          recentChannels.length > 0 || isRecent
            ? [{ id: RECENT_CATEGORY_ID, label: '🕘 Récentes', count: recentChannels.length }]
            : []
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <IconSearch size={16} />
            </span>
            <TextInput
              className="pl-9"
              placeholder={searchGuides ? 'Rechercher une chaîne ou un programme…' : 'Rechercher une chaîne…'}
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              disabled={isPinned}
            />
          </div>
          <label
            className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-300"
            title="Cherche aussi dans les titres et descriptions des programmes, du programme en cours au dernier jour du guide (≈ 5 jours). Seules les chaînes qui ont un guide sont couvertes."
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={searchGuides}
              onChange={(e) => toggleSearchGuides(e.target.checked)}
              disabled={isPinned}
            />
            Chercher aussi dans les guides
          </label>
        </div>

        <div className="flex items-center justify-between px-5 pt-3 text-sm text-gray-400">
          <span>
            {isFavorites ? (
              <>
                <span className="text-gray-200">★ Favoris</span>
                <span className="ml-2 text-gray-600">· {favorites.count('live')} chaînes</span>
              </>
            ) : isRecent ? (
              <>
                <span className="text-gray-200">🕘 Récentes</span>
                <span className="ml-2 text-gray-600">· {recentChannels.length} chaînes</span>
              </>
            ) : isSearching ? (
              <>
                Résultats pour « <span className="text-gray-200">{query.trim()}</span> »
              </>
            ) : (
              <span className="text-gray-200">{selectedCategoryName}</span>
            )}
            {!isPinned && !feed.loading && !feed.error && (
              <span className="ml-2 text-gray-600">· {feed.total} chaînes</span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-2">
          {showGuideResults && <GuideSearchResults query={query.trim()} onPlayChannel={onPlayChannel} />}
          {showGuideResults && (
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Chaînes</h3>
          )}
          {isFavorites ? (
            <FavoritesView
              kind="live"
              onActivate={(f) => onPlayChannel(favToLive(f))}
              onOpenGuide={(f) => setGuideChannel(favToLive(f))}
            />
          ) : isRecent ? (
            recentChannels.length === 0 ? (
              <EmptyState
                icon={<IconBroadcast size={36} />}
                title="Aucune chaîne récente"
                description="Les chaînes que vous regardez apparaissent ici, la plus récente en premier."
              />
            ) : (
              <div className="space-y-2">
                {recentChannels.map((p) => (
                  <LiveChannelRow
                    key={p.itemId}
                    channel={recentToLive(p)}
                    onPlay={onPlayChannel}
                    onOpenGuide={setGuideChannel}
                  />
                ))}
              </div>
            )
          ) : feed.loading ? (
            <LoadingState label="Chargement des chaînes…" />
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.reload} retryLabel="Réessayer" />
          ) : feed.items.length === 0 ? (
            showGuideResults ? (
              <p className="rounded-lg border border-white/10 bg-surface-sunken p-3 text-sm text-gray-500">
                Aucune chaîne ne porte « {query.trim()} » dans son nom.
              </p>
            ) : isSearching ? (
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
