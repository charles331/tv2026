import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type {
  AppSettings,
  ConnectionTestResult,
  CredentialsStatus,
  RefreshCatalogResult,
  TmdbKeyStatus
} from '@shared/index'
import { CHANGELOG } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'
import {
  Button,
  Field,
  TextInput,
  Badge,
  Spinner,
  IconFolder,
  IconRefresh
} from '../../components/ui'
import { formatDateFromEpochSecs } from '../../lib/format'

const STATUS_LABELS: Record<
  ConnectionTestResult['status'],
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  active: { label: 'Compte actif', tone: 'success' },
  expired: { label: 'Abonnement expiré', tone: 'danger' },
  banned: { label: 'Compte banni', tone: 'danger' },
  disabled: { label: 'Compte désactivé', tone: 'danger' },
  unknown: { label: 'Statut inconnu', tone: 'neutral' }
}

export function SettingsScreen({
  onCatalogRefreshed
}: {
  onCatalogRefreshed?: (result: RefreshCatalogResult) => void
}): ReactElement {
  const [creds, setCreds] = useState<CredentialsStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [savingCreds, setSavingCreds] = useState(false)
  const [credsMessage, setCredsMessage] = useState<string | null>(null)
  const [credsError, setCredsError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<RefreshCatalogResult | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const [pickingDir, setPickingDir] = useState(false)

  const [tmdbKey, setTmdbKey] = useState('')
  const [tmdbStatus, setTmdbStatus] = useState<TmdbKeyStatus | null>(null)
  const [savingTmdb, setSavingTmdb] = useState(false)
  const [tmdbMessage, setTmdbMessage] = useState<string | null>(null)

  const [appVersion, setAppVersion] = useState<string | null>(null)

  // Prefill from stored (non-secret) status.
  useEffect(() => {
    void api()
      .connection.getCredentials()
      .then((r) => {
        if (r.ok) {
          setCreds(r.data)
          setBaseUrl(r.data.baseUrl ?? '')
          setUsername(r.data.username ?? '')
        }
      })
    void api()
      .settings.get()
      .then((r) => {
        if (r.ok) setSettings(r.data)
      })
    void api()
      .tmdb.getStatus()
      .then((r) => {
        if (r.ok) setTmdbStatus(r.data)
      })
    void api()
      .app.info()
      .then((r) => {
        if (r.ok) setAppVersion(r.data.version)
      })
  }, [])

  const handleSaveCreds = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setSavingCreds(true)
      setCredsMessage(null)
      setCredsError(null)
      try {
        const trimmedUrl = baseUrl.trim().replace(/\/+$/, '')
        const status = unwrap(
          await api().connection.setCredentials({
            baseUrl: trimmedUrl,
            username: username.trim(),
            password
          })
        )
        setCreds(status)
        setBaseUrl(trimmedUrl)
        setPassword('')
        setCredsMessage('Identifiants enregistrés (mot de passe chiffré).')
        setTestResult(null)
      } catch (err) {
        setCredsError(describeError(err))
      } finally {
        setSavingCreds(false)
      }
    },
    [baseUrl, username, password]
  )

  const handleClearCreds = useCallback(async () => {
    setCredsError(null)
    setCredsMessage(null)
    try {
      const status = unwrap(await api().connection.clearCredentials())
      setCreds(status)
      setUsername('')
      setPassword('')
      setBaseUrl('')
      setTestResult(null)
      setCredsMessage('Identifiants effacés.')
    } catch (err) {
      setCredsError(describeError(err))
    }
  }, [])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      setTestResult(unwrap(await api().connection.test()))
    } catch (err) {
      setTestError(describeError(err))
    } finally {
      setTesting(false)
    }
  }, [])

  const handlePickDir = useCallback(async () => {
    setPickingDir(true)
    try {
      const { path } = unwrap(await api().settings.pickDownloadDir())
      if (path) {
        const next = unwrap(await api().settings.set({ downloadDir: path }))
        setSettings(next)
      }
    } catch (err) {
      setCredsError(describeError(err))
    } finally {
      setPickingDir(false)
    }
  }, [])

  const handleSaveTmdb = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setSavingTmdb(true)
      setTmdbMessage(null)
      try {
        const next = unwrap(await api().tmdb.setKey(tmdbKey.trim()))
        setTmdbStatus(next)
        setTmdbKey('')
        setTmdbMessage(
          next.hasKey
            ? 'Clé TMDB enregistrée (chiffrée). Les notes TMDB s’afficheront sur les fiches films.'
            : 'Clé TMDB effacée. Les fiches affichent à nouveau la note du fournisseur.'
        )
      } catch (err) {
        setTmdbMessage(describeError(err))
      } finally {
        setSavingTmdb(false)
      }
    },
    [tmdbKey]
  )

  const handleClearTmdb = useCallback(async () => {
    setTmdbMessage(null)
    try {
      const next = unwrap(await api().tmdb.clearKey())
      setTmdbStatus(next)
      setTmdbKey('')
      setTmdbMessage('Clé TMDB effacée.')
    } catch (err) {
      setTmdbMessage(describeError(err))
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    setRefreshResult(null)
    try {
      const result = unwrap(await api().catalog.refresh({ force: true }))
      setRefreshResult(result)
      onCatalogRefreshed?.(result)
    } catch (err) {
      setRefreshError(describeError(err))
    } finally {
      setRefreshing(false)
    }
  }, [onCatalogRefreshed])

  const [refreshingSeries, setRefreshingSeries] = useState(false)
  const [seriesMessage, setSeriesMessage] = useState<string | null>(null)
  const [seriesError, setSeriesError] = useState<string | null>(null)

  const handleRefreshSeries = useCallback(async () => {
    setRefreshingSeries(true)
    setSeriesError(null)
    setSeriesMessage(null)
    try {
      const result = unwrap(await api().series.refresh({ force: true }))
      setSeriesMessage(
        `Séries à jour : ${result.categories} catégories, ${result.series} séries.`
      )
    } catch (err) {
      setSeriesError(describeError(err))
    } finally {
      setRefreshingSeries(false)
    }
  }, [])

  const statusInfo = testResult ? STATUS_LABELS[testResult.status] : null
  const encryptionUnavailable = creds && !creds.encryptionAvailable

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 fade-in">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Réglages</h1>
        <p className="mt-1 text-sm text-gray-400">
          Connexion au panel Xtream, dossier de téléchargement et catalogue.
        </p>
      </header>

      {/* Connexion */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <h2 className="text-base font-medium text-gray-100">Connexion</h2>
        <p className="mt-1 text-xs text-gray-500">
          Le mot de passe est chiffré localement (safeStorage) et n’est jamais renvoyé en clair.
        </p>

        {encryptionUnavailable && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Le chiffrement OS n’est pas disponible sur cette machine — le mot de passe ne pourra pas
            être stocké de façon sécurisée.
          </div>
        )}

        <form className="mt-4 space-y-4" onSubmit={handleSaveCreds}>
          <Field label="URL de base" hint="Ex. http://mon-panel.exemple:8080 (sans barre finale)">
            <TextInput
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="http://exemple.com:8080"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Identifiant">
              <TextInput
                autoComplete="off"
                placeholder="utilisateur"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field
              label="Mot de passe"
              hint={
                creds?.hasCredentials
                  ? 'Un mot de passe est déjà enregistré ; ressaisissez-le pour le modifier.'
                  : undefined
              }
            >
              <TextInput
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </div>

          {credsError && <p className="text-sm text-red-300">{credsError}</p>}
          {credsMessage && <p className="text-sm text-emerald-300">{credsMessage}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" loading={savingCreds}>
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" onClick={handleTest} loading={testing}>
              Tester la connexion
            </Button>
            {creds?.hasCredentials && (
              <Button type="button" variant="ghost" onClick={handleClearCreds}>
                Effacer
              </Button>
            )}
          </div>
        </form>

        {/* Résultat du test */}
        {(testResult || testError) && (
          <div className="mt-4 rounded-lg border border-white/10 bg-surface-sunken p-4">
            {testError ? (
              <p className="text-sm text-red-300">{testError}</p>
            ) : testResult && statusInfo ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                  {testResult.isTrial && <Badge tone="warning">Essai</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-gray-400">
                  <dt>Expiration</dt>
                  <dd className="text-gray-200">
                    {testResult.expiresAt == null
                      ? 'Illimité / inconnu'
                      : formatDateFromEpochSecs(testResult.expiresAt)}
                  </dd>
                  <dt>Connexions max.</dt>
                  <dd className="text-gray-200">{testResult.maxConnections ?? '—'}</dd>
                  <dt>Connexions actives</dt>
                  <dd className="text-gray-200">{testResult.activeConnections ?? '—'}</dd>
                </dl>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Dossier de téléchargement */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <h2 className="text-base font-medium text-gray-100">Dossier de téléchargement</h2>
        <p className="mt-1 text-xs text-gray-500">
          Emplacement où les films seront enregistrés (nommage :{' '}
          {settings?.filenameTemplate ?? '{title} ({year})'}).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="flex-1 truncate rounded-lg border border-white/10 bg-surface-sunken px-3 py-2 text-sm text-gray-300">
            {settings?.downloadDir ?? 'Aucun dossier sélectionné'}
          </code>
          <Button
            variant="secondary"
            icon={<IconFolder size={16} />}
            onClick={handlePickDir}
            loading={pickingDir}
          >
            Choisir…
          </Button>
        </div>
      </section>

      {/* Rafraîchir le catalogue */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <h2 className="text-base font-medium text-gray-100">Catalogue</h2>
        <p className="mt-1 text-xs text-gray-500">
          Récupère les catégories et l’ensemble des films (~26 680) depuis le fournisseur vers le
          cache local. L’opération peut durer plusieurs minutes.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={!refreshing ? <IconRefresh size={16} /> : undefined}
            onClick={handleRefresh}
            loading={refreshing}
          >
            {refreshing ? 'Rafraîchissement…' : 'Rafraîchir le catalogue'}
          </Button>
          {refreshing && (
            <span className="flex items-center gap-2 text-sm text-gray-400">
              <Spinner size={14} /> Cela peut prendre un moment, ne fermez pas l’application.
            </span>
          )}
        </div>
        {refreshError && <p className="mt-3 text-sm text-red-300">{refreshError}</p>}
        {refreshResult && (
          <p className="mt-3 text-sm text-emerald-300">
            Catalogue à jour : {refreshResult.categories} catégories, {refreshResult.streams} films.
          </p>
        )}
      </section>

      {/* Rafraîchir les séries */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <h2 className="text-base font-medium text-gray-100">Séries</h2>
        <p className="mt-1 text-xs text-gray-500">
          Récupère les catégories et la liste des séries depuis le fournisseur vers le cache local.
          Les saisons et épisodes sont chargés à l’ouverture d’une série.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={!refreshingSeries ? <IconRefresh size={16} /> : undefined}
            onClick={handleRefreshSeries}
            loading={refreshingSeries}
          >
            {refreshingSeries ? 'Rafraîchissement…' : 'Rafraîchir les séries'}
          </Button>
          {refreshingSeries && (
            <span className="flex items-center gap-2 text-sm text-gray-400">
              <Spinner size={14} /> Patientez, ne fermez pas l’application.
            </span>
          )}
        </div>
        {seriesError && <p className="mt-3 text-sm text-red-300">{seriesError}</p>}
        {seriesMessage && <p className="mt-3 text-sm text-emerald-300">{seriesMessage}</p>}
      </section>

      {/* Notes TMDB */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <h2 className="text-base font-medium text-gray-100">Notes des films (TMDB)</h2>
        <p className="mt-1 text-xs text-gray-500">
          Par défaut, la note affichée vient du fournisseur (souvent figée ou approximative).
          Renseignez une clé API <strong>TMDB</strong> (gratuite) pour afficher la note communautaire
          à jour sur les fiches films. Laissez vide pour désactiver.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Obtenir une clé :{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-accent-hover underline"
          >
            themoviedb.org → Paramètres → API
          </a>{' '}
          (clé « API Key (v3 auth) »).
        </p>

        {tmdbStatus && !tmdbStatus.encryptionAvailable && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Le chiffrement OS n’est pas disponible sur cette machine — la clé ne pourra pas être
            stockée de façon sécurisée.
          </div>
        )}

        <form className="mt-4 space-y-3" onSubmit={handleSaveTmdb}>
          <Field
            label="Clé API TMDB (v3)"
            hint={
              tmdbStatus?.hasKey
                ? 'Une clé est déjà enregistrée (chiffrée). Saisissez-en une nouvelle pour la remplacer.'
                : undefined
            }
          >
            <TextInput
              type="password"
              autoComplete="off"
              placeholder={tmdbStatus?.hasKey ? '•••••••• (clé enregistrée)' : 'ex. 0123456789abcdef…'}
              value={tmdbKey}
              onChange={(e) => setTmdbKey(e.target.value)}
            />
          </Field>
          {tmdbMessage && <p className="text-sm text-emerald-300">{tmdbMessage}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" loading={savingTmdb} disabled={!tmdbKey.trim()}>
              Enregistrer la clé
            </Button>
            {tmdbStatus?.hasKey && (
              <Button type="button" variant="ghost" onClick={handleClearTmdb}>
                Effacer
              </Button>
            )}
          </div>
        </form>
      </section>

      {/* Nouveautés (changelog) */}
      <section className="rounded-xl border border-white/10 bg-surface-raised p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-medium text-gray-100">Nouveautés</h2>
          {appVersion && <Badge tone="neutral">Version {appVersion}</Badge>}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Historique des modifications de l’application.
        </p>

        <ol className="mt-4 space-y-4">
          {CHANGELOG.map((entry) => {
            const isCurrent = entry.version === appVersion
            return (
              <li
                key={entry.version}
                className="rounded-lg border border-white/10 bg-surface-sunken p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">v{entry.version}</span>
                  {isCurrent && <Badge tone="success">Actuelle</Badge>}
                  <span className="ml-auto text-xs text-gray-500">{entry.date}</span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
                  {entry.changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
