import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import type { VodCategory } from '@shared/index'
import { cn, Spinner, TextInput, IconSearch } from '../../components/ui'
import { FAVORITES_CATEGORY_ID } from '../../lib/favorites'

const WIDTH_KEY = 'tv2026.categorySidebarWidth'
const MIN_WIDTH = 180
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 240

function readStoredWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH
}

export function CategorySidebar({
  categories,
  loading,
  error,
  selectedId,
  onSelect,
  title = 'Catégories',
  allLabel = 'Tous les films',
  favoritesCount
}: {
  categories: VodCategory[]
  loading: boolean
  error: string | null
  /** null = all categories; FAVORITES_CATEGORY_ID = favorites. */
  selectedId: string | null
  onSelect: (categoryId: string | null) => void
  /** Sidebar heading (default "Catégories"). */
  title?: string
  /** Label of the "all" entry (default "Tous les films"). */
  allLabel?: string
  /** When defined, show a pinned "★ Favoris" entry at the very top with this count. */
  favoritesCount?: number
}): ReactElement {
  const asideRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState<number>(() => readStoredWidth())
  const [filter, setFilter] = useState('')

  // Persist the chosen width across screens / sessions.
  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  // Drag the right edge to resize; clamps to [MIN, MAX].
  const startResize = useCallback((e: ReactMouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = asideRef.current?.offsetWidth ?? DEFAULT_WIDTH
    const onMove = (ev: globalThis.MouseEvent): void => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)))
      setWidth(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const q = filter.trim().toLowerCase()
  const filtered = q
    ? categories.filter((c) => c.categoryName.toLowerCase().includes(q))
    : categories

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-white/10 bg-surface-raised/60"
    >
      <div className="px-3 pb-2 pt-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h2>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500">
            <IconSearch size={14} />
          </span>
          <TextInput
            className="h-8 pl-7 text-xs"
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="flex justify-center py-6 text-gray-500">
            <Spinner size={18} />
          </div>
        ) : error ? (
          <p className="px-2 py-3 text-xs text-red-300">{error}</p>
        ) : (
          <ul className="space-y-0.5">
            {/* Pinned, always first, even while filtering. */}
            {favoritesCount !== undefined && (
              <li>
                <CategoryButton
                  label="★ Favoris"
                  count={favoritesCount}
                  active={selectedId === FAVORITES_CATEGORY_ID}
                  onClick={() => onSelect(FAVORITES_CATEGORY_ID)}
                />
              </li>
            )}
            {q === '' && (
              <li>
                <CategoryButton
                  label={allLabel}
                  active={selectedId === null}
                  onClick={() => onSelect(null)}
                />
              </li>
            )}
            {filtered.map((cat) => (
              <li key={cat.categoryId}>
                <CategoryButton
                  label={cat.categoryName}
                  count={cat.streamCount}
                  active={selectedId === cat.categoryId}
                  onClick={() => onSelect(cat.categoryId)}
                />
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-gray-600">Aucune catégorie.</li>
            )}
          </ul>
        )}
      </nav>
      {/* Drag handle to resize the column width. */}
      <div
        onMouseDown={startResize}
        title="Redimensionner la colonne"
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40"
      />
    </aside>
  )
}

function CategoryButton({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-accent/20 font-medium text-accent-hover'
          : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'
      )}
    >
      <span className="truncate">{label}</span>
      {count != null && (
        <span className={cn('shrink-0 text-xs', active ? 'text-accent-hover/80' : 'text-gray-600')}>
          {count}
        </span>
      )}
    </button>
  )
}
