import { useState, type ReactElement } from 'react'
import type { AddFavoriteRequest } from '@shared/index'
import { useFavorites } from '../../lib/favorites'
import { Button, IconStar, cn } from '../../components/ui'

/**
 * Star toggle to pin/unpin a favorite. `variant`:
 *  - 'button' : labelled button (movie/series detail pages)
 *  - 'icon'   : compact icon-only (live channel rows, cards)
 */
export function FavoriteButton({
  req,
  variant = 'button',
  size = 'md'
}: {
  req: AddFavoriteRequest
  variant?: 'button' | 'icon'
  size?: 'sm' | 'md' | 'lg'
}): ReactElement {
  const { isFavorite, toggle } = useFavorites()
  const [busy, setBusy] = useState(false)
  const active = isFavorite(req.kind, req.itemId)

  const onClick = async (e: { stopPropagation: () => void }): Promise<void> => {
    e.stopPropagation()
    setBusy(true)
    try {
      await toggle(req)
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={active}
        title={active ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
          active
            ? 'text-amber-300 hover:bg-white/[0.08]'
            : 'text-gray-500 hover:bg-white/[0.08] hover:text-gray-300'
        )}
      >
        <IconStar size={18} />
      </button>
    )
  }

  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size={size}
      loading={busy}
      onClick={onClick}
      icon={<IconStar size={size === 'lg' ? 18 : 16} />}
      className={active ? 'text-amber-300' : undefined}
      title={active ? 'Retirer des favoris' : 'Ajouter aux favoris'}
    >
      {active ? 'En favori' : 'Favori'}
    </Button>
  )
}
