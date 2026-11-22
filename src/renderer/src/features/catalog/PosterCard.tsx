import { memo, type ReactElement } from 'react'
import { CardCaption } from '../../components/CardCaption'
import { displayName } from '@shared/displayName'
import type { VodStream } from '@shared/index'
import { Poster, Badge, IconStar, IconCheck } from '../../components/ui'
import { formatRating } from '../../lib/format'
import { LowQualityTag, PosterFileLabel } from '../movie/quality'
import { useFileCheck } from '../../lib/fileChecks'
import { useProgress } from '../../lib/progress'
import { WatchProgressBar } from '../progress/ProgressBar'

function PosterCardImpl({
  stream,
  downloaded,
  onSelect,
  active = false,
  onPointerSelect
}: {
  stream: VodStream
  downloaded: boolean
  onSelect: (stream: VodStream) => void
  /** Selected by the remote control (the grid owns the selection). */
  active?: boolean
  /** Mouse press: the grid moves its selection here. */
  onPointerSelect?: () => void
}): ReactElement {
  // A check made on the movie page this session wins over the list's data.
  const known = useFileCheck(stream.streamId)
  const sizeBytes = known?.sizeBytes ?? stream.fileSizeBytes
  const durationSecs = known ? known.durationSecs : stream.fileDurationSecs
  const video = known?.video ?? stream.fileVideo
  const watchProgress = useProgress().get('movie', stream.streamId)
  return (
    <button
      type="button"
      onClick={() => onSelect(stream)}
      onMouseDown={onPointerSelect}
      data-remote-focus={active}
      data-remote=""
      className="remote-card group flex w-full min-w-0 flex-col rounded-lg text-left focus-visible:outline-none"
      title={displayName(stream.name)}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-poster-hover group-hover:ring-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Poster src={stream.streamIcon} alt={displayName(stream.name)} className="h-full w-full" />
        {/* Top gradient + badges */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          {stream.rating != null && stream.rating > 0 ? (
            <span className="flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 backdrop-blur">
              <IconStar size={11} /> {formatRating(stream.rating)}
            </span>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-end gap-1">
            {downloaded && (
              <Badge tone="success" className="backdrop-blur">
                <IconCheck size={11} /> Téléchargé
              </Badge>
            )}
            {watchProgress?.watched && (
              <Badge tone="neutral" className="backdrop-blur">
                <IconCheck size={11} /> Vu
              </Badge>
            )}
            <LowQualityTag name={stream.name} />
          </div>
        </div>
        {sizeBytes ? (
          <div className="pointer-events-none absolute bottom-1.5 left-1.5">
            <PosterFileLabel sizeBytes={sizeBytes} durationSecs={durationSecs} video={video} />
          </div>
        ) : null}
        <WatchProgressBar
          progress={watchProgress}
          className="pointer-events-none absolute inset-x-0 bottom-0 rounded-none bg-black/60"
        />
      </div>
      <CardCaption title={displayName(stream.name)} meta={stream.year ?? '—'} />
    </button>
  )
}

export const PosterCard = memo(PosterCardImpl)
