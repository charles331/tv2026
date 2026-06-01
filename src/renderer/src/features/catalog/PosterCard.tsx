import { memo, type ReactElement } from 'react'
import type { VodStream } from '@shared/index'
import { Poster, Badge, IconStar, IconCheck } from '../../components/ui'
import { formatRating } from '../../lib/format'

function PosterCardImpl({
  stream,
  downloaded,
  onSelect
}: {
  stream: VodStream
  downloaded: boolean
  onSelect: (stream: VodStream) => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect(stream)}
      className="group flex w-full flex-col text-left focus-visible:outline-none"
      title={stream.name}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-poster-hover group-hover:ring-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Poster src={stream.streamIcon} alt={stream.name} className="h-full w-full" />
        {/* Top gradient + badges */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          {stream.rating != null && stream.rating > 0 ? (
            <span className="flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 backdrop-blur">
              <IconStar size={11} /> {formatRating(stream.rating)}
            </span>
          ) : (
            <span />
          )}
          {downloaded && (
            <Badge tone="success" className="backdrop-blur">
              <IconCheck size={11} /> Téléchargé
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <p className="truncate text-sm font-medium text-gray-100 group-hover:text-white">
          {stream.name}
        </p>
        <p className="text-xs text-gray-500">{stream.year ?? '—'}</p>
      </div>
    </button>
  )
}

export const PosterCard = memo(PosterCardImpl)
