import { type ReactElement } from 'react'
import type { FavoriteItem, FavoriteKind } from '@shared/index'
import { useFavorites } from '../../lib/favorites'
import { Badge, Button, Poster, EmptyState, IconStar, IconPlay, IconTv } from '../../components/ui'
import { FavoriteButton } from './FavoriteButton'

/** Build the AddFavoriteRequest snapshot from a stored favorite (for the toggle). */
function reqOf(f: FavoriteItem): {
  kind: FavoriteKind
  itemId: number
  name: string
  image: string | null
  containerExtension: string | null
  categoryId: string | null
} {
  return {
    kind: f.kind,
    itemId: f.itemId,
    name: f.name,
    image: f.image,
    containerExtension: f.containerExtension,
    categoryId: f.categoryId
  }
}

function OfflineBadge(): ReactElement {
  return (
    <span title="Source indisponible depuis le dernier rafraîchissement">
      <Badge tone="danger">Hors ligne</Badge>
    </span>
  )
}

/**
 * Renders the favorites of one section. Movies/series use a poster grid; live
 * uses a channel list. Unavailable favorites are kept but flagged "Hors ligne".
 */
export function FavoritesView({
  kind,
  onActivate,
  onOpenGuide
}: {
  kind: FavoriteKind
  /** Open (movie/series) or play (live) the favorite. */
  onActivate: (item: FavoriteItem) => void
  /** Live only: open the programme guide for a favorite channel. */
  onOpenGuide?: (item: FavoriteItem) => void
}): ReactElement {
  const { lists } = useFavorites()
  const items = lists[kind]

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconStar size={36} />}
        title="Aucun favori"
        description={
          kind === 'live'
            ? 'Ajoutez des chaînes en favori avec l’étoile pour les retrouver ici.'
            : 'Ajoutez des films ou séries en favori avec l’étoile pour les retrouver ici.'
        }
      />
    )
  }

  // Live → list of channel-style rows.
  if (kind === 'live') {
    return (
      <div className="h-full overflow-y-auto px-1 py-1">
        <div className="space-y-2">
          {items.map((f) => (
            <div
              key={f.itemId}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface-raised p-3"
            >
              <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-sunken">
                <Poster src={f.image} alt={f.name} className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-100">{f.name}</p>
                {!f.available && (
                  <div className="mt-1">
                    <OfflineBadge />
                  </div>
                )}
              </div>
              {onOpenGuide && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconTv size={14} />}
                  title="Guide des programmes"
                  onClick={() => onOpenGuide(f)}
                >
                  Guide
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={<IconPlay size={14} />}
                disabled={!f.available}
                onClick={() => onActivate(f)}
              >
                Regarder
              </Button>
              <FavoriteButton req={reqOf(f)} variant="icon" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Movies / series → poster grid.
  return (
    <div className="h-full overflow-y-auto px-1 py-1">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}
      >
        {items.map((f) => (
          <div key={f.itemId} className="group relative flex w-full min-w-0 flex-col">
            <button
              type="button"
              onClick={() => onActivate(f)}
              className="flex w-full min-w-0 flex-col text-left focus-visible:outline-none"
              title={f.name}
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:ring-accent/40">
                <Poster src={f.image} alt={f.name} className="h-full w-full" />
                {!f.available && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-center bg-black/60 py-1 backdrop-blur">
                    <OfflineBadge />
                  </div>
                )}
              </div>
              <p className="mt-2 w-full min-w-0 truncate px-0.5 text-sm font-medium text-gray-100 group-hover:text-white">
                {f.name}
              </p>
            </button>
            {/* Unpin (top-right, on hover). */}
            <div className="absolute right-1 top-1 rounded-md bg-black/50 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
              <FavoriteButton req={reqOf(f)} variant="icon" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
