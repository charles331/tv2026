/**
 * Bibliothèque: what is on the disk, played in one press without the provider.
 * Tabs Films / Séries / Enregistrements / Autres fichiers; a series opens the
 * list of its downloaded episodes. « Actualiser » picks up files added by hand;
 * « Supprimer » sends a file to the Recycle Bin after two confirmations.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { LibraryItem, LibraryListing, VodStream } from '@shared/index'
import { displayName } from '@shared/displayName'
import { api, describeError, unwrap } from '../../lib/ipc'
import { useToast } from '../../lib/toast'
import { useProgress } from '../../lib/progress'
import { formatBytes } from '../../lib/format'
import { FocusZone, useFocusWhenReady } from '../../lib/remote/focus'
import { CardGrid } from '../../components/CardGrid'
import { CardCaption } from '../../components/CardCaption'
import {
  Button,
  EmptyState,
  ErrorState,
  FocusButton,
  IconLibrary,
  IconRefresh,
  IconX,
  LoadingState,
  Poster,
  Spinner,
  cn
} from '../../components/ui'
import { WatchProgressBar } from '../progress/ProgressBar'
import { episodeWatch, seriesWatchSummary, type WatchState } from './libraryWatch'
import { LibraryEpisodes } from './LibraryEpisodes'
import { ConfirmDelete } from './ConfirmDelete'

type Tab = 'movie' | 'series' | 'recording' | 'file'

const TAB_LABEL: Record<Tab, string> = {
  movie: 'Films',
  series: 'Séries',
  recording: 'Enregistrements',
  file: 'Autres fichiers'
}

/** One card: a file, or a series (its downloaded episodes). */
interface Card {
  key: string
  title: string
  image: string | null
  meta: string
  item: LibraryItem | null
  episodes: LibraryItem[]
  /** Series: episodes not watched to the end yet. */
  left: number
}

function seriesKey(it: LibraryItem): string {
  if (it.seriesId != null) return `id:${it.seriesId}`
  return `name:${(it.seriesName ?? it.title).toLowerCase()}`
}

function buildCards(
  items: LibraryItem[],
  tab: Tab,
  watchOf: (it: LibraryItem) => WatchState = () => 'new'
): Card[] {
  if (tab !== 'series') {
    const kind = tab === 'movie' ? 'movie' : tab
    return items
      .filter((it) => it.kind === kind)
      .map((it) => ({
        key: `item:${it.id}`,
        title: displayName(it.title),
        image: it.image,
        meta: formatBytes(it.sizeBytes),
        item: it,
        episodes: [],
        left: 0
      }))
  }
  const groups = new Map<string, LibraryItem[]>()
  for (const it of items) {
    if (it.kind !== 'episode') continue
    const key = seriesKey(it)
    const list = groups.get(key)
    if (list) list.push(it)
    else groups.set(key, [it])
  }
  return [...groups.entries()].map(([key, eps]) => {
    const first = eps[0]!
    const states = eps.map(watchOf)
    return {
      key: `series:${key}`,
      title: displayName(first.seriesName ?? first.title),
      image: eps.find((e) => e.image)?.image ?? null,
      meta: seriesWatchSummary(states),
      item: null,
      episodes: eps,
      left: states.filter((st) => st !== 'watched').length
    }
  })
}

export function LibraryScreen({
  onPlay,
  onOpenMovie,
  onGoToCatalog
}: {
  onPlay: (item: LibraryItem) => void
  onOpenMovie: (stream: VodStream) => void
  onGoToCatalog: () => void
}): ReactElement {
  const toast = useToast()
  const progress = useProgress()
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>('movie')
  const [activeIndex, setActiveIndex] = useState(0)
  const [openSeries, setOpenSeries] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<LibraryItem | null>(null)

  const load = useCallback(async () => {
    try {
      setListing(unwrap(await api().library.list()))
      setError(null)
    } catch (e) {
      setError(describeError(e))
    }
  }, [])

  // On arrival, and whenever a download finishes (it lands here).
  useEffect(() => {
    void load()
    return api().downloads.onState((e) => {
      if (e.status === 'completed') void load()
    })
  }, [load])

  const items = useMemo(() => listing?.items ?? [], [listing])
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { movie: 0, series: 0, recording: 0, file: 0 }
    c.series = buildCards(items, 'series').length
    for (const it of items) if (it.kind !== 'episode') c[it.kind] += 1
    return c
  }, [items])
  const tabs: Tab[] =
    counts.file > 0 ? ['movie', 'series', 'recording', 'file'] : ['movie', 'series', 'recording']
  const watchOf = useCallback(
    (it: LibraryItem): WatchState =>
      it.streamId == null ? 'new' : episodeWatch(progress.get('series', it.streamId)).state,
    [progress]
  )
  const cards = useMemo(() => buildCards(items, tab, watchOf), [items, tab, watchOf])
  const active = cards[Math.min(activeIndex, cards.length - 1)] ?? null
  const seriesOpen = openSeries
    ? (buildCards(items, 'series', watchOf).find((c) => c.key === openSeries) ?? null)
    : null

  useFocusWhenReady('library-grid', cards.length > 0, 'screen-library')

  // The open series lost its last episode: close its list.
  useEffect(() => {
    if (openSeries && listing && !seriesOpen) setOpenSeries(null)
  }, [openSeries, seriesOpen, listing])

  const openSheet = useCallback(
    async (item: LibraryItem): Promise<void> => {
      if (item.streamId == null) return onPlay(item)
      try {
        const source = unwrap(await api().downloads.findSource(item.streamId, 'movie'))
        if (source?.kind === 'movie') return onOpenMovie(source.stream)
        toast.show('Ce film n’est plus dans le catalogue : lecture directe.', 'info')
      } catch (e) {
        toast.show(describeError(e), 'error')
      }
      onPlay(item)
    },
    [onOpenMovie, onPlay, toast]
  )

  // OK / click: a movie opens its sheet, a series its episodes, anything else plays.
  const activate = useCallback(
    (card: Card) => {
      if (!card.item) setOpenSeries(card.key)
      else if (card.item.kind === 'movie') void openSheet(card.item)
      else onPlay(card.item)
    },
    [onPlay, openSheet]
  )

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const r = unwrap(await api().library.refresh())
      if (r.folderMissing)
        toast.show('Dossier de téléchargement introuvable : rien n’a été modifié.', 'info')
      else
        toast.show(
          `${r.added} ajouté${r.added > 1 ? 's' : ''}, ${r.removed} retiré${r.removed > 1 ? 's' : ''}`,
          'success'
        )
      await load()
    } catch (e) {
      toast.show(describeError(e), 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const remove = async (item: LibraryItem): Promise<void> => {
    setConfirm(null)
    try {
      unwrap(await api().library.remove(item.id))
      toast.show(`« ${displayName(item.title)} » mis à la Corbeille.`, 'success')
    } catch (e) {
      toast.show(describeError(e), 'error')
    }
    await load()
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Bibliothèque</h1>
          {listing && (
            <p className="mt-1 text-sm text-gray-500">
              {listing.freeBytes != null && `${formatBytes(listing.freeBytes)} libres · `}
              {formatBytes(listing.usedBytes)} dans la bibliothèque
            </p>
          )}
        </div>
        <FocusZone focusKey="library-toolbar" className="flex items-center gap-2">
          <Button focusKey="library-refresh" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <Spinner size={14} /> : <IconRefresh size={14} />}
            Actualiser
          </Button>
        </FocusZone>
      </header>

      {listing?.folderMissing && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          Dossier de téléchargement introuvable (disque débranché ?) : rien n’a été retiré de la
          bibliothèque.
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !listing ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconLibrary size={36} />}
          title="Bibliothèque vide"
          description="Vos téléchargements terminés apparaîtront ici. « Actualiser » retrouve aussi les vidéos ajoutées à la main dans le dossier de téléchargement."
          action={<Button onClick={onGoToCatalog}>Parcourir les films</Button>}
        />
      ) : (
        <>
          <FocusZone focusKey="library-tabs" className="mb-4 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <FocusButton
                key={t}
                focusKey={`library-tab-${t}`}
                type="button"
                onClick={() => {
                  setTab(t)
                  setActiveIndex(0)
                }}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm transition-colors',
                  tab === t
                    ? 'bg-accent/20 font-medium text-accent-hover'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
                )}
              >
                {TAB_LABEL[t]} <span className="text-gray-600">{counts[t]}</span>
              </FocusButton>
            ))}
          </FocusZone>

          {cards.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">Rien ici pour l’instant.</p>
          ) : (
            <CardGrid
              key={tab}
              items={cards}
              focusKey="library-grid"
              minCardWidth={168}
              onActivate={activate}
              onActiveChange={setActiveIndex}
              renderCard={(card, _i, isActive, onPointerSelect) => (
                <div key={card.key} className="group relative flex min-w-0 flex-col">
                  <button
                    type="button"
                    onClick={() => activate(card)}
                    onMouseDown={onPointerSelect}
                    data-remote-focus={isActive}
                    data-remote=""
                    className="remote-card flex w-full min-w-0 flex-col rounded-lg text-left focus-visible:outline-none"
                    title={card.title}
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-poster ring-1 ring-white/5 transition-all duration-200 group-hover:ring-accent/40">
                      <Poster src={card.image} alt={card.title} className="h-full w-full" />
                      {card.item?.kind === 'movie' && card.item.streamId != null && (
                        <WatchProgressBar
                          progress={progress.get('movie', card.item.streamId)}
                          className="pointer-events-none absolute inset-x-0 bottom-0 rounded-none bg-black/60"
                        />
                      )}
                      {!card.item && (
                        <span
                          className={cn(
                            'pointer-events-none absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold shadow',
                            card.left > 0 ? 'bg-accent text-white' : 'bg-black/70 text-gray-300'
                          )}
                        >
                          {card.left > 0 ? `${card.left} à voir` : '✓ Vu'}
                        </span>
                      )}
                    </div>
                    <CardCaption title={card.title} meta={card.meta} />
                  </button>
                  {/* Mouse: delete from the card (the remote uses the bar below). */}
                  {card.item && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Supprimer"
                      title="Supprimer (Corbeille)"
                      onClick={() => setConfirm(card.item)}
                      className="absolute right-1 top-1 rounded-md bg-black/60 p-1.5 text-gray-300 opacity-0 backdrop-blur transition-opacity hover:text-red-300 group-hover:opacity-100"
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>
              )}
            />
          )}

          {active && (
            <FocusZone
              focusKey="library-actions"
              className="library-actions mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4"
            >
              <span className="mr-2 min-w-0 truncate text-sm text-gray-400">{active.title}</span>
              {active.item ? (
                <>
                  <Button
                    focusKey="library-play"
                    variant="primary"
                    onClick={() => onPlay(active.item!)}
                  >
                    Lire
                  </Button>
                  {active.item.kind === 'movie' && active.item.streamId != null && (
                    <Button onClick={() => void openSheet(active.item!)}>Fiche</Button>
                  )}
                  <Button variant="danger" onClick={() => setConfirm(active.item)}>
                    Supprimer
                  </Button>
                </>
              ) : (
                <Button
                  focusKey="library-play"
                  variant="primary"
                  onClick={() => setOpenSeries(active.key)}
                >
                  Épisodes
                </Button>
              )}
            </FocusZone>
          )}
        </>
      )}

      {seriesOpen && (
        <LibraryEpisodes
          title={seriesOpen.title}
          episodes={seriesOpen.episodes}
          onPlay={onPlay}
          onDelete={setConfirm}
          onClose={() => setOpenSeries(null)}
        />
      )}
      {confirm && (
        <ConfirmDelete
          item={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void remove(confirm)}
        />
      )}
    </div>
  )
}
