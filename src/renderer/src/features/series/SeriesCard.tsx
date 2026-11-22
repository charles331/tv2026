import { memo, type ReactElement } from 'react'
import { CardCaption } from '../../components/CardCaption'
import { displayName } from '@shared/displayName'
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
      title={displayName(series.name)}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-poster-hover group-hover:ring-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Poster src={series.cover} alt={displayName(series.name)} className="h-full w-full" />
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
      <CardCaption title={displayName(series.name)} meta={series.year ?? '—'} />
    </button>
  )
}

export const SeriesCard = memo(SeriesCardImpl)
