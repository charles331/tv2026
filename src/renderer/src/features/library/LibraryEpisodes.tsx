/**
 * The downloaded episodes of one series, in season/episode order. The
 * selection opens on the first episode not watched yet; OK plays, the button
 * on the right deletes (with the double confirmation). Back closes.
 */
import { useEffect, useMemo, type ReactElement } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { LibraryItem } from '@shared/index'
import { displayName } from '@shared/displayName'
import { FocusButton, IconCheck, IconX } from '../../components/ui'
import { FocusZone, useBackHandler, useReturnFocus } from '../../lib/remote/focus'
import { useProgress } from '../../lib/progress'
import { formatBytes } from '../../lib/format'

function tag(item: LibraryItem): string {
  if (item.season == null || item.episode == null) return ''
  return `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
}

export function LibraryEpisodes({
  title,
  episodes,
  onPlay,
  onDelete,
  onClose
}: {
  title: string
  episodes: LibraryItem[]
  onPlay: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => void
  onClose: () => void
}): ReactElement {
  const progress = useProgress()
  useReturnFocus()
  useBackHandler(onClose)
  const sorted = useMemo(
    () =>
      [...episodes].sort(
        (a, b) =>
          (a.season ?? 0) - (b.season ?? 0) ||
          (a.episode ?? 0) - (b.episode ?? 0) ||
          a.title.localeCompare(b.title)
      ),
    [episodes]
  )
  const watched = (it: LibraryItem): boolean =>
    it.streamId != null && !!progress.get('series', it.streamId)?.watched
  const firstKey = useMemo(() => {
    const next = sorted.find(
      (it) => !(it.streamId != null && progress.get('series', it.streamId)?.watched)
    )
    return next ?? sorted[0]
  }, [sorted, progress])

  useEffect(() => {
    if (firstKey) setFocus(`library-ep-${firstKey.id}`)
    // Only when the dialog opens or its first episode changes.
  }, [firstKey])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <FocusZone
        focusKey="library-episodes"
        boundary
        className="fade-in flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="truncate text-lg font-semibold text-white">{displayName(title)}</h2>
          <FocusButton
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
          >
            <IconX size={18} />
          </FocusButton>
        </div>
        <ul className="-m-1 space-y-1 overflow-y-auto p-1">
          {sorted.map((ep) => (
            <li key={ep.id} className="flex items-center gap-2">
              <FocusButton
                focusKey={`library-ep-${ep.id}`}
                type="button"
                onClick={() => onPlay(ep)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/[0.06]"
              >
                <span className="shrink-0 font-mono text-xs text-gray-500">{tag(ep)}</span>
                <span className="min-w-0 flex-1 truncate">{displayName(ep.title)}</span>
                {watched(ep) && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500">
                    <IconCheck size={12} /> Vu
                  </span>
                )}
                <span className="shrink-0 text-xs text-gray-600">{formatBytes(ep.sizeBytes)}</span>
              </FocusButton>
              <FocusButton
                type="button"
                onClick={() => onDelete(ep)}
                className="shrink-0 rounded-lg px-3 py-2 text-xs text-gray-400 hover:bg-red-500/15 hover:text-red-300"
              >
                Supprimer
              </FocusButton>
            </li>
          ))}
        </ul>
      </FocusZone>
    </div>
  )
}
