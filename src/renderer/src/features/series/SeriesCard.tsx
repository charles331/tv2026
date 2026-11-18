import { memo, type ReactElement } from 'react'
import type { SeriesStream } from '@shared/index'
import { Poster, IconStar } from '../../components/ui'
import { formatRating } from '../../lib/format'

function SeriesCardImpl({
  series,
  onSelect,
  index,
  active = false,
  onPointerSelect
}: {
  series: SeriesStream
  onSelect: (series: SeriesStream) => void
  /** Position in a remote-navigable grid (to scroll the active card into view). */
  index?: number
  /** Selected by the remote control (the grid owns the selection). */
  active?: boolean
  /** Mouse press: the grid moves its selection here. */
  onPointerSelect?: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect(series)}
      onMouseDown={onPointerSelect}
      data-index={index}
      data-remote-focus={active}
      data-remote=""
      className="remote-card group flex rounded-lg w-full min-w-0 flex-col text-left focus-visible:outline-none"
      title={series.name}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-poster-hover group-hover:ring-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Poster src={series.cover} alt={series.name} className="h-full w-full" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          {series.rating != null && series.rating > 0 ? (
            <span className="flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 backdrop-blur">
              <IconStar size={11} /> {formatRating(series.rating)}
            </span>
          ) : (
            <span />
          )}
        </div>
      </div>
      <div className="mt-2 w-full min-w-0 px-0.5">
        <p className="truncate text-sm font-medium text-gray-100 group-hover:text-white">
          {series.name}
        </p>
        <p className="truncate text-xs text-gray-500">{series.year ?? '—'}</p>
      </div>
    </button>
  )
}

export const SeriesCard = memo(SeriesCardImpl)
