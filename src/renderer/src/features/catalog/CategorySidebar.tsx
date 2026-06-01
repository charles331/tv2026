import type { ReactElement } from 'react'
import type { VodCategory } from '@shared/index'
import { cn, Spinner } from '../../components/ui'

export function CategorySidebar({
  categories,
  loading,
  error,
  selectedId,
  onSelect
}: {
  categories: VodCategory[]
  loading: boolean
  error: string | null
  /** null = all categories. */
  selectedId: string | null
  onSelect: (categoryId: string | null) => void
}): ReactElement {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 bg-surface-raised/60">
      <div className="px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Catégories</h2>
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
            <li>
              <CategoryButton
                label="Tous les films"
                active={selectedId === null}
                onClick={() => onSelect(null)}
              />
            </li>
            {categories.map((cat) => (
              <li key={cat.categoryId}>
                <CategoryButton
                  label={cat.categoryName}
                  count={cat.streamCount}
                  active={selectedId === cat.categoryId}
                  onClick={() => onSelect(cat.categoryId)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
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
