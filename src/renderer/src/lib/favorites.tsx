/**
 * Favorites store. Holds the user's pinned movies / series / live channels
 * (with their live `available` flag) and exposes membership + toggle helpers.
 * Provided once at the app root so detail views, the sidebar and the favorites
 * views all share one source of truth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import type { AddFavoriteRequest, FavoriteItem, FavoriteKind } from '@shared/index'
import { api, describeError, unwrap } from './ipc'

/** Synthetic category id used to show the favorites of a section. */
export const FAVORITES_CATEGORY_ID = '__favorites__'

type Lists = Record<FavoriteKind, FavoriteItem[]>

interface FavoritesContextValue {
  lists: Lists
  isFavorite: (kind: FavoriteKind, itemId: number) => boolean
  count: (kind: FavoriteKind) => number
  toggle: (req: AddFavoriteRequest) => Promise<void>
  /** Re-fetch a kind (e.g. after a catalog refresh changes availability). */
  reload: (kind?: FavoriteKind) => Promise<void>
}

const EMPTY: Lists = { movie: [], series: [], live: [] }
const FavoritesContext = createContext<FavoritesContextValue | null>(null)
const KINDS: FavoriteKind[] = ['movie', 'series', 'live']

export function FavoritesProvider({ children }: { children: ReactNode }): ReactElement {
  const [lists, setLists] = useState<Lists>(EMPTY)

  const reload = useCallback(async (kind?: FavoriteKind) => {
    const kinds = kind ? [kind] : KINDS
    await Promise.all(
      kinds.map(async (k) => {
        try {
          const items = unwrap(await api().favorites.list(k))
          setLists((prev) => ({ ...prev, [k]: items }))
        } catch (e) {
          console.warn(`favorites.list(${k}) a échoué :`, describeError(e))
        }
      })
    )
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const isFavorite = useCallback(
    (kind: FavoriteKind, itemId: number) => lists[kind].some((f) => f.itemId === itemId),
    [lists]
  )

  const count = useCallback((kind: FavoriteKind) => lists[kind].length, [lists])

  const toggle = useCallback(
    async (req: AddFavoriteRequest) => {
      const already = lists[req.kind].some((f) => f.itemId === req.itemId)
      try {
        if (already) unwrap(await api().favorites.remove(req.kind, req.itemId))
        else unwrap(await api().favorites.add(req))
      } catch (e) {
        console.warn('favorites toggle a échoué :', describeError(e))
      }
      await reload(req.kind)
    },
    [lists, reload]
  )

  return (
    <FavoritesContext.Provider value={{ lists, isFavorite, count, toggle, reload }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider')
  return ctx
}
