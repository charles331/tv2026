import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CredentialsStatus, PlayRequest, VodInfo, VodStream } from '@shared/index'
import { api } from './lib/ipc'
import { DownloadsProvider, useDownloads } from './lib/downloads'
import { useConnectionBusy } from './lib/connectionLock'
import { AppNav, type Route } from './components/AppNav'
import { LoadingState } from './components/ui'
import { CatalogScreen } from './features/catalog/CatalogScreen'
import { DownloadsScreen } from './features/downloads/DownloadsScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { MovieDetail } from './features/movie/MovieDetail'
import { PlayerView } from './features/player/PlayerView'

export function App(): ReactElement {
  return (
    <DownloadsProvider>
      <AppShell />
    </DownloadsProvider>
  )
}

function AppShell(): ReactElement {
  const [route, setRoute] = useState<Route>('catalog')
  const [creds, setCreds] = useState<CredentialsStatus | null>(null)
  const [credsLoaded, setCredsLoaded] = useState(false)
  const [selected, setSelected] = useState<VodStream | null>(null)
  const [playRequest, setPlayRequest] = useState<PlayRequest | null>(null)

  const { items } = useDownloads()
  const busy = useConnectionBusy()

  const activeDownloads = useMemo(
    () =>
      items.filter(
        (it) => it.status === 'downloading' || it.status === 'queued' || it.status === 'paused'
      ).length,
    [items]
  )

  const refreshCreds = useCallback(() => {
    void api()
      .connection.getCredentials()
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

  if (!credsLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <LoadingState label="Initialisation…" />
      </div>
    )
  }

  return (
    <div className="flex h-full bg-surface text-gray-100">
      <AppNav
        route={route}
        onNavigate={setRoute}
        activeDownloads={activeDownloads}
        busyReason={busy.busy ? busy.reason : null}
      />

      <main className="min-w-0 flex-1">
        {route === 'catalog' && (
          <CatalogScreen onSelectMovie={setSelected} onGoToSettings={() => setRoute('settings')} />
        )}
        {route === 'downloads' && <DownloadsScreen />}
        {route === 'settings' && <SettingsScreen onCatalogRefreshed={() => refreshCreds()} />}
      </main>

      {selected && (
        <MovieDetail stream={selected} onClose={() => setSelected(null)} onPlay={handlePlay} />
      )}

      {playRequest && <PlayerView request={playRequest} onClose={() => setPlayRequest(null)} />}
    </div>
  )
}
