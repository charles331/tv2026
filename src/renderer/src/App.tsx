import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type {
  Episode,
  CredentialsStatus,
  LiveStream,
  PlayRequest,
  SeriesStream,
  VodInfo,
  VodStream
} from '@shared/index'
import { api, describeError, unwrap } from './lib/ipc'
import { DownloadsProvider, useDownloads } from './lib/downloads'
import { useConnectionBusy } from './lib/connectionLock'
import { useChangelogStatus } from './lib/changelog'
import { ToastProvider, useToast } from './lib/toast'
import { FavoritesProvider, useFavorites } from './lib/favorites'
import { RemindersProvider, useReminders } from './lib/reminders'
import { AppNav, type Route } from './components/AppNav'
import { Button, LoadingState } from './components/ui'
import { CatalogScreen } from './features/catalog/CatalogScreen'
import { SeriesScreen } from './features/series/SeriesScreen'
import { SeriesDetail } from './features/series/SeriesDetail'
import { LiveScreen } from './features/live/LiveScreen'
import { DownloadsScreen } from './features/downloads/DownloadsScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { ScheduledScreen } from './features/reminders/ScheduledScreen'
import { ConflictDialog } from './features/reminders/ConflictDialog'
import { MovieDetail } from './features/movie/MovieDetail'
import { PlayerView } from './features/player/PlayerView'

export function App(): ReactElement {
  return (
    <ToastProvider>
      <FavoritesProvider>
        <RemindersProvider>
          <DownloadsProvider>
            <AppShell />
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

  const { items } = useDownloads()
  const busy = useConnectionBusy()
  const toast = useToast()
  const { reload: reloadFavorites } = useFavorites()
  const { reminders } = useReminders()
  const { hasUnseen: changelogHasUnseen, markSeen: markChangelogSeen } = useChangelogStatus()

  const scheduledCount = useMemo(
    () =>
      reminders.filter(
        (r) => r.status === 'scheduled' || r.status === 'notified' || r.status === 'recording'
      ).length,
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

  const handlePlay = useCallback(async (stream: VodStream, info: VodInfo | null) => {
    setSelected(null)
    const title = info?.title ?? info?.name ?? stream.name
    const containerExtension = info?.containerExtension ?? stream.containerExtension

    // Prefer offline playback of a completed local download: it doesn't take
    // the single-connection lock, so it never pauses ongoing downloads.
    // Any failure falls back to streaming from the provider.
    let localFilePath: string | null = null
    try {
      const r = await api().downloads.localPath(stream.streamId)
      if (r.ok) localFilePath = r.data.path
      else console.warn('localPath a échoué, lecture en streaming :', r.error.message)
    } catch (e) {
      console.warn('localPath a levé une exception, lecture en streaming :', e)
    }

    setPlayRequest(
      localFilePath
        ? { kind: 'local', filePath: localFilePath, title }
        : { kind: 'stream', streamId: stream.streamId, containerExtension, title }
    )
  }, [])

  const handlePlayChannel = useCallback((channel: LiveStream) => {
    // Live is stream-only (it acquires the connection lock → downloads pause).
    setPlayRequest({
      kind: 'stream',
      mediaKind: 'live',
      streamId: channel.streamId,
      containerExtension: 'ts',
      title: channel.name
    })
  }, [])

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

  const handlePlayEpisode = useCallback(async (episode: Episode, seriesName: string) => {
    setSelectedSeries(null)
    const title = `${seriesName} S${String(episode.season).padStart(2, '0')}E${String(
      episode.episodeNum
    ).padStart(2, '0')}`

    // Prefer an already-downloaded local episode (no provider connection taken).
    let localFilePath: string | null = null
    try {
      const r = await api().downloads.localPath(episode.episodeId, 'series')
      if (r.ok) localFilePath = r.data.path
    } catch (e) {
      console.warn('localPath épisode a échoué, lecture en streaming :', e)
    }

    setPlayRequest(
      localFilePath
        ? { kind: 'local', filePath: localFilePath, title }
        : {
            kind: 'stream',
            mediaKind: 'series',
            streamId: episode.episodeId,
            containerExtension: episode.containerExtension,
            title
          }
    )
  }, [])

  // Refresh movies + series + live in one go (triggered from the nav, confirmed
  // by the user). Reports the outcome via a toast.
  const runUpdateAll = useCallback(async () => {
    setConfirmUpdateAll(false)
    setUpdatingAll(true)
    try {
      const movies = unwrap(await api().catalog.refresh({ force: true }))
      const series = unwrap(await api().series.refresh({ force: true }))
      const live = unwrap(await api().live.refresh({ force: true }))
      // Availability of favorites may have changed (sources added/removed).
      await reloadFavorites()
      toast.show(
        `Catalogues à jour : ${movies.streams} films, ${series.series} séries, ${live.channels} chaînes.`,
        'success'
      )
    } catch (e) {
      toast.show(`Échec de la mise à jour : ${describeError(e)}`, 'error')
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
          onNavigate={setRoute}
          activeDownloads={activeDownloads}
          scheduledCount={scheduledCount}
          busyReason={busy.busy ? busy.reason : null}
          settingsHasUnseen={changelogHasUnseen}
          onUpdateAll={() => setConfirmUpdateAll(true)}
          updatingAll={updatingAll}
        />

        <main className="min-w-0 flex-1">
          {route === 'catalog' && (
            <CatalogScreen onSelectMovie={setSelected} onGoToSettings={() => setRoute('settings')} />
          )}
          {route === 'series' && (
            <SeriesScreen
              onSelectSeries={setSelectedSeries}
              onGoToSettings={() => setRoute('settings')}
            />
          )}
          {route === 'live' && (
            <LiveScreen onPlayChannel={handlePlayChannel} onGoToSettings={() => setRoute('settings')} />
          )}
          {route === 'scheduled' && <ScheduledScreen />}
          {route === 'downloads' && <DownloadsScreen />}
          {route === 'settings' && <SettingsScreen onCatalogRefreshed={() => refreshCreds()} />}
        </main>
      </div>

      {/* Non-blocking player bar (mpv plays in its own window; navigation stays free). */}
      {playRequest && <PlayerView request={playRequest} onClose={() => setPlayRequest(null)} />}

      {/* Recording-vs-playback conflict prompt (driven by the main scheduler). */}
      <ConflictDialog />

      {selected && (
        <MovieDetail stream={selected} onClose={() => setSelected(null)} onPlay={handlePlay} />
      )}

      {selectedSeries && (
        <SeriesDetail
          series={selectedSeries}
          onClose={() => setSelectedSeries(null)}
          onPlayEpisode={handlePlayEpisode}
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
