import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  Episode,
  CredentialsStatus,
  LiveStream,
  PlayRequest,
  SeriesStream,
  VodInfo,
  VodStream,
  WatchProgress
} from '@shared/index'
import { isActiveReminderStatus, resumeStart } from '@shared/index'
import { api, describeError, unwrap } from './lib/ipc'
import { DownloadsProvider, useDownloads } from './lib/downloads'
import { useConnectionBusy } from './lib/connectionLock'
import { useChangelogStatus } from './lib/changelog'
import { ToastProvider, useToast } from './lib/toast'
import { FavoritesProvider, useFavorites } from './lib/favorites'
import { RemindersProvider, useReminders } from './lib/reminders'
import { ProgressProvider, useProgress } from './lib/progress'
import { AppNav, type Route } from './components/AppNav'
import { Button, LoadingState } from './components/ui'
import { SearchScreen, type SearchTarget } from './features/search/SearchScreen'
import { CatalogScreen } from './features/catalog/CatalogScreen'
import { SeriesScreen } from './features/series/SeriesScreen'
import { SeriesDetail } from './features/series/SeriesDetail'
import { LiveScreen } from './features/live/LiveScreen'
import { DownloadsScreen } from './features/downloads/DownloadsScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { ScheduledScreen } from './features/reminders/ScheduledScreen'
import { ConflictDialog } from './features/reminders/ConflictDialog'
import { MovieDetail } from './features/movie/MovieDetail'
import { PlayerView, type PlayerNeighbor } from './features/player/PlayerView'

export function App(): ReactElement {
  return (
    <ToastProvider>
      <FavoritesProvider>
        <RemindersProvider>
          <DownloadsProvider>
            <ProgressProvider>
              <AppShell />
            </ProgressProvider>
          </DownloadsProvider>
        </RemindersProvider>
      </FavoritesProvider>
    </ToastProvider>
  )
}

function AppShell(): ReactElement {
  const [route, setRoute] = useState<Route>('catalog')
  const [creds, setCreds] = useState<CredentialsStatus | null>(null)
  const [credsLoaded, setCredsLoaded] = useState(false)
  const [selected, setSelected] = useState<VodStream | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<SeriesStream | null>(null)
  const [playRequest, setPlayRequest] = useState<PlayRequest | null>(null)
  const [confirmUpdateAll, setConfirmUpdateAll] = useState(false)
  const [updatingAll, setUpdatingAll] = useState(false)
  // Bumped when "Tout mettre à jour" finishes: used as the key of the catalogue
  // screens so the one currently displayed remounts and refetches fresh data.
  const [catalogEpoch, setCatalogEpoch] = useState(0)
  // Global search: its query survives a detour to another tab; "Tout voir"
  // opens a catalogue tab seeded with that query (dropped on the next navigation).
  const [globalQuery, setGlobalQuery] = useState('')
  const [seed, setSeed] = useState<{ route: SearchTarget; query: string } | null>(null)
  const navigate = useCallback((next: Route) => {
    setSeed(null)
    setRoute(next)
  }, [])
  const seeAll = useCallback((target: SearchTarget, query: string) => {
    setSeed({ route: target, query })
    setRoute(target)
  }, [])
  const seedFor = (target: SearchTarget): string => (seed?.route === target ? seed.query : '')

  // Ctrl+K (Cmd+K) opens the global search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const { items } = useDownloads()
  const busy = useConnectionBusy()
  const toast = useToast()
  const { reload: reloadFavorites } = useFavorites()
  const { reminders } = useReminders()
  const progress = useProgress()
  const { hasUnseen: changelogHasUnseen, markSeen: markChangelogSeen } = useChangelogStatus()

  const scheduledCount = useMemo(
    () => reminders.filter((r) => isActiveReminderStatus(r.status)).length,
    [reminders]
  )

  const activeDownloads = useMemo(
    () =>
      items.filter(
        (it) => it.status === 'downloading' || it.status === 'queued' || it.status === 'paused'
      ).length,
    [items]
  )

  const refreshCreds = useCallback(() => {
    void api()
      .connection.getCredentialsStatus()
      .then((r) => {
        if (r.ok) setCreds(r.data)
        setCredsLoaded(true)
      })
  }, [])

  useEffect(() => {
    refreshCreds()
  }, [refreshCreds])

  // No credentials yet -> force the Settings screen so the user configures the
  // connection before browsing.
  useEffect(() => {
    if (credsLoaded && creds && !creds.hasCredentials) setRoute('settings')
  }, [credsLoaded, creds])

  // The changelog lives in Settings; opening it acknowledges the current version
  // and clears the "what's new" badge.
  useEffect(() => {
    if (route === 'settings') markChangelogSeen()
  }, [route, markChangelogSeen])

  /**
   * Play a movie or an episode, resuming where the user stopped unless
   * `fromStart`. Prefers a completed local download: it doesn't take the
   * single-connection lock, so it never pauses ongoing downloads. Any failure
   * to find it falls back to streaming from the provider.
   */
  const playItem = useCallback(
    async (
      item: {
        mediaKind: 'movie' | 'series'
        id: number
        title: string
        containerExtension: string
        image: string | null
        seriesId?: number
      },
      fromStart = false
    ) => {
      let localFilePath: string | null = null
      try {
        const r = await api().downloads.localPath(
          item.id,
          item.mediaKind === 'series' ? 'series' : undefined
        )
        if (r.ok) localFilePath = r.data.path
        else console.warn('localPath a échoué, lecture en streaming :', r.error.message)
      } catch (e) {
        console.warn('localPath a levé une exception, lecture en streaming :', e)
      }

      if (fromStart) await progress.clear(item.mediaKind, item.id)
      const startSecs = fromStart
        ? undefined
        : (resumeStart(progress.get(item.mediaKind, item.id)) ?? undefined)

      setPlayRequest({
        kind: localFilePath ? 'local' : 'stream',
        filePath: localFilePath ?? undefined,
        mediaKind: item.mediaKind,
        streamId: item.id,
        containerExtension: item.containerExtension,
        title: item.title,
        image: item.image,
        seriesId: item.seriesId,
        startSecs
      })
    },
    [progress]
  )

  const handlePlay = useCallback(
    (stream: VodStream, info: VodInfo | null, fromStart = false) => {
      setSelected(null)
      void playItem(
        {
          mediaKind: 'movie',
          id: stream.streamId,
          title: info?.title ?? info?.name ?? stream.name,
          containerExtension: info?.containerExtension ?? stream.containerExtension,
          image: stream.streamIcon
        },
        fromStart
      )
    },
    [playItem]
  )

  /** "Reprendre": replay an item from its stored snapshot. */
  const handleResume = useCallback(
    (p: WatchProgress) => {
      if (p.kind === 'live') return
      void playItem({
        mediaKind: p.kind,
        id: p.itemId,
        title: p.name,
        containerExtension: p.containerExtension ?? 'mkv',
        image: p.image,
        seriesId: p.seriesId ?? undefined
      })
    },
    [playItem]
  )

  const handlePlayChannel = useCallback((channel: LiveStream) => {
    // Live is stream-only (it acquires the connection lock → downloads pause).
    setPlayRequest({
      kind: 'stream',
      mediaKind: 'live',
      streamId: channel.streamId,
      containerExtension: 'ts',
      title: channel.name,
      image: channel.icon
    })
  }, [])

  // App-update lifecycle: announce key transitions ONCE each (per version) —
  // available (background check), downloaded (user may have left Réglages
  // mid-download), and download failures. The initial pull covers events that
  // fired before this subscription existed (startup check vs React boot).
  const announcedUpdateRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const announce = (e: { phase: string; latestVersion?: string; message?: string }): void => {
      const key = `${e.phase}:${e.latestVersion ?? ''}`
      if (announcedUpdateRef.current.has(key)) return
      announcedUpdateRef.current.add(key)
      if (e.phase === 'available' && e.latestVersion) {
        toast.show(
          `Mise à jour ${e.latestVersion} disponible — ouvrez les Réglages pour la télécharger.`,
          'info',
          10000
        )
      } else if (e.phase === 'downloaded') {
        toast.show(
          `Mise à jour ${e.latestVersion ?? ''} prête — ouvrez les Réglages pour l’installer.`,
          'success',
          10000
        )
      } else if (e.phase === 'error') {
        toast.show(
          `Échec du téléchargement de la mise à jour : ${e.message ?? 'erreur inconnue'}.`,
          'error'
        )
      }
    }
    void api()
      .app.getUpdateState()
      .then((r) => {
        if (r.ok && r.data) announce(r.data)
      })
    return api().app.onUpdateStatus(announce)
  }, [toast])

  // A clicked reminder notification asks the renderer to open/play the channel.
  useEffect(() => {
    return api().reminders.onOpenChannel((e) => {
      setRoute('live')
      setPlayRequest({
        kind: 'stream',
        mediaKind: 'live',
        streamId: e.streamId,
        containerExtension: 'ts',
        title: e.channelName
      })
    })
  }, [])

  const handlePlayEpisode = useCallback(
    (series: SeriesStream, episode: Episode, seriesName: string, fromStart = false) => {
      setSelectedSeries(null)
      const title = `${seriesName} S${String(episode.season).padStart(2, '0')}E${String(
        episode.episodeNum
      ).padStart(2, '0')}`
      void playItem(
        {
          mediaKind: 'series',
          id: episode.episodeId,
          title,
          containerExtension: episode.containerExtension,
          image: episode.image ?? series.cover,
          seriesId: series.seriesId
        },
        fromStart
      )
    },
    [playItem]
  )

  // Previous / next of what is playing: episodes of the series (in viewing
  // order) or channels of the category (zapping). Looked up on each new source.
  const [neighbors, setNeighbors] = useState<{
    previous: PlayerNeighbor | null
    next: PlayerNeighbor | null
  }>({ previous: null, next: null })
  // The lookups below outlive a render: always call the latest playItem (it
  // reads the current watch progress to resume the neighbour at the right place).
  const playItemRef = useRef(playItem)
  playItemRef.current = playItem
  const playingKind = playRequest?.mediaKind
  const playingId = playRequest?.streamId
  const playingSeriesId = playRequest?.seriesId
  useEffect(() => {
    let cancelled = false
    const none = { previous: null, next: null }
    setNeighbors(none)
    if (playingId == null) return
    const pad = (n: number): string => String(n).padStart(2, '0')
    const load = async (): Promise<typeof neighbors> => {
      if (playingKind === 'live') {
        const n = unwrap(await api().live.neighbors(playingId))
        const of = (c: LiveStream | null): PlayerNeighbor | null =>
          c ? { label: c.name, play: () => handlePlayChannel(c) } : null
        return { previous: of(n.previous), next: of(n.next) }
      }
      if (playingKind === 'series' && playingSeriesId != null) {
        const n = unwrap(await api().series.episodeNeighbors(playingSeriesId, playingId))
        const of = (e: Episode | null): PlayerNeighbor | null =>
          e
            ? {
                label: `S${pad(e.season)}E${pad(e.episodeNum)} — ${e.title}`,
                play: () =>
                  void playItemRef.current({
                    mediaKind: 'series',
                    id: e.episodeId,
                    title: `${n.seriesName} S${pad(e.season)}E${pad(e.episodeNum)}`,
                    containerExtension: e.containerExtension,
                    image: e.image ?? n.cover,
                    seriesId: playingSeriesId
                  })
              }
            : null
        return { previous: of(n.previous), next: of(n.next) }
      }
      return none
    }
    load()
      .then((n) => {
        if (!cancelled) setNeighbors(n)
      })
      .catch((e) => console.warn('voisins de lecture indisponibles :', describeError(e)))
    return () => {
      cancelled = true
    }
  }, [playingKind, playingId, playingSeriesId, handlePlayChannel])
  // Read by the "file ended" callback, which must see the latest lookup.
  const nextRef = useRef(neighbors.next)
  nextRef.current = neighbors.next

  // Refresh movies + series + live in one go (triggered from the nav, confirmed
  // by the user). Reports the outcome via a toast.
  const runUpdateAll = useCallback(async () => {
    setConfirmUpdateAll(false)
    setUpdatingAll(true)
    try {
      // Each catalogue on its own: a failure on one (e.g. films) must not leave
      // the others stale. Sequential, the provider allows a single connection.
      const parts: { label: string; run: () => Promise<string> }[] = [
        {
          label: 'films',
          run: async () => `${unwrap(await api().catalog.refresh({ force: true })).streams} films`
        },
        {
          label: 'séries',
          run: async () => `${unwrap(await api().series.refresh({ force: true })).series} séries`
        },
        {
          label: 'chaînes',
          run: async () => `${unwrap(await api().live.refresh({ force: true })).channels} chaînes`
        }
      ]
      const done: string[] = []
      const failed: string[] = []
      for (const part of parts) {
        try {
          done.push(await part.run())
        } catch (e) {
          failed.push(`${part.label} (${describeError(e)})`)
        }
      }
      if (done.length > 0) {
        // Availability of favorites may have changed (sources added/removed).
        await reloadFavorites()
        // Remount the catalogue screens so the fresh data shows immediately —
        // without this the displayed screen kept its pre-refresh list.
        setCatalogEpoch((e) => e + 1)
      }
      if (failed.length === 0) {
        toast.show(`Catalogues à jour : ${done.join(', ')}.`, 'success')
      } else {
        toast.show(
          (done.length > 0 ? `Mis à jour : ${done.join(', ')}. ` : '') +
            `Échec pour : ${failed.join(' ; ')}. Détails dans Réglages → Journal.`,
          'error',
          12000
        )
      }
    } finally {
      setUpdatingAll(false)
    }
  }, [toast, reloadFavorites])

  if (!credsLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <LoadingState label="Initialisation…" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-surface text-gray-100">
      {/* Main row: nav + active screen. Shrinks when the player bar is shown. */}
      <div className="flex min-h-0 flex-1">
        <AppNav
          route={route}
          onNavigate={navigate}
          activeDownloads={activeDownloads}
          scheduledCount={scheduledCount}
          busyReason={busy.busy ? busy.reason : null}
          settingsHasUnseen={changelogHasUnseen}
          onUpdateAll={() => setConfirmUpdateAll(true)}
          updatingAll={updatingAll}
        />

        <main className="min-w-0 flex-1">
          {route === 'search' && (
            <SearchScreen
              query={globalQuery}
              onQueryChange={setGlobalQuery}
              onSelectMovie={setSelected}
              onSelectSeries={setSelectedSeries}
              onPlayChannel={handlePlayChannel}
              onSeeAll={seeAll}
            />
          )}
          {route === 'catalog' && (
            <CatalogScreen
              key={`${catalogEpoch}:${seedFor('catalog')}`}
              initialQuery={seedFor('catalog')}
              onSelectMovie={setSelected}
              onResume={handleResume}
              onGoToSettings={() => setRoute('settings')}
            />
          )}
          {route === 'series' && (
            <SeriesScreen
              key={`${catalogEpoch}:${seedFor('series')}`}
              initialQuery={seedFor('series')}
              onSelectSeries={setSelectedSeries}
              onResume={handleResume}
              onGoToSettings={() => setRoute('settings')}
            />
          )}
          {route === 'live' && (
            <LiveScreen
              key={`${catalogEpoch}:${seedFor('live')}`}
              initialQuery={seedFor('live')}
              onPlayChannel={handlePlayChannel}
              onGoToSettings={() => setRoute('settings')}
            />
          )}
          {route === 'scheduled' && <ScheduledScreen />}
          {route === 'downloads' && (
            <DownloadsScreen onOpenMovie={setSelected} onOpenSeries={setSelectedSeries} />
          )}
          {route === 'settings' && <SettingsScreen onCatalogRefreshed={() => refreshCreds()} />}
        </main>
      </div>

      {/* Non-blocking player bar (mpv plays in its own window; navigation stays free). */}
      {playRequest && (
        <PlayerView
          request={playRequest}
          onClose={() => setPlayRequest(null)}
          previous={neighbors.previous}
          next={neighbors.next}
          onEnded={() => {
            // An episode ended: chain the next one (live never "ends").
            const following = playRequest.mediaKind === 'series' ? nextRef.current : null
            if (!following) return false
            toast.show(`Épisode suivant : ${following.label}`, 'info')
            following.play()
            return true
          }}
        />
      )}

      {/* Recording-vs-playback conflict prompt (driven by the main scheduler). */}
      <ConflictDialog />

      {selected && (
        <MovieDetail stream={selected} onClose={() => setSelected(null)} onPlay={handlePlay} />
      )}

      {selectedSeries && (
        <SeriesDetail
          series={selectedSeries}
          onClose={() => setSelectedSeries(null)}
          onPlayEpisode={(episode, seriesName, fromStart) =>
            handlePlayEpisode(selectedSeries, episode, seriesName, fromStart)
          }
        />
      )}

      {confirmUpdateAll && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setConfirmUpdateAll(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fade-in w-full max-w-md rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Tout mettre à jour ?</h2>
            <p className="mt-2 text-sm text-gray-400">
              Les catalogues <strong>films</strong>, <strong>séries</strong> et <strong>direct</strong>{' '}
              seront re-téléchargés depuis le fournisseur vers le cache local. L’opération peut
              durer plusieurs minutes.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmUpdateAll(false)}>
                Annuler
              </Button>
              <Button variant="primary" onClick={() => void runUpdateAll()}>
                Tout mettre à jour
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
