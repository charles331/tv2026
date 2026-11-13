/**
 * Programmes found by a search inside all live guides ("Chercher aussi dans les
 * guides"): on air first, then upcoming, grouped by day, with Regarder /
 * Rappel / Enregistrer. HD/FHD/4K variants sharing one guide are shown as chips.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { GuideSearchHit, GuideSearchResult, LiveStream, ReminderMode } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'
import { useReminders } from '../../lib/reminders'
import { useToast } from '../../lib/toast'
import { formatClockFromEpochSecs } from '../../lib/format'
import { Badge, Button, Poster, Spinner, ErrorState, IconPlay, IconRecord } from '../../components/ui'
import { dayLabel } from './ChannelGuide'

function dayKey(secs: number): string {
  const d = new Date(secs * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function sinceLabel(ms: number | null): string {
  if (ms == null) return ''
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  return `il y a ${Math.round(min / 60)} h`
}

export function GuideSearchResults({
  query,
  onPlayChannel
}: {
  query: string
  onPlayChannel: (channel: LiveStream) => void
}): ReactElement | null {
  const [result, setResult] = useState<GuideSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const reminders = useReminders()
  const toast = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api()
      .live.searchGuide(query)
      .then((r) => {
        if (!cancelled) setResult(unwrap(r))
      })
      .catch((e) => {
        if (!cancelled) setError(describeError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, nonce])

  const nowSecs = Math.floor(Date.now() / 1000)
  const groups = useMemo(() => {
    const onAir: GuideSearchHit[] = []
    const days = new Map<string, { label: string; items: GuideSearchHit[] }>()
    for (const h of result?.hits ?? []) {
      if (h.startSecs <= nowSecs) {
        onAir.push(h)
        continue
      }
      const k = dayKey(h.startSecs)
      const g = days.get(k)
      if (g) g.items.push(h)
      else days.set(k, { label: dayLabel(h.startSecs), items: [h] })
    }
    const out = [...days.entries()].map(([key, g]) => ({ key, ...g }))
    return onAir.length ? [{ key: 'now', label: 'En cours', items: onAir }, ...out] : out
  }, [result, nowSecs])

  const toggleReminder = async (h: GuideSearchHit, channel: LiveStream, mode: ReminderMode): Promise<void> => {
    const existing = reminders.has(channel.streamId, h.startSecs, h.title)
    if (existing) {
      await reminders.cancel(existing.id)
      toast.show(`Rappel annulé : « ${h.title} »`, 'info')
      return
    }
    const r = await reminders.add({
      streamId: channel.streamId,
      channelName: channel.name,
      channelIcon: channel.icon,
      epgId: null,
      title: h.title,
      description: h.description,
      startSecs: h.startSecs,
      endSecs: h.endSecs,
      mode
    })
    toast.show(
      r
        ? mode === 'notify'
          ? `Rappel ajouté : « ${h.title} »`
          : `Enregistrement programmé : « ${h.title} »`
        : 'Impossible d’ajouter le rappel.',
      r ? 'success' : 'error'
    )
  }

  const header = (
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="font-semibold uppercase tracking-wide text-gray-400">
        Dans les guides
        {result && !loading && (
          <span className="ml-2 font-normal normal-case tracking-normal text-gray-600">
            · {result.hits.length}
            {result.truncated ? '+' : ''} programme{result.hits.length > 1 ? 's' : ''}
          </span>
        )}
      </span>
      {result?.guideFetchedAt != null && (
        <span className="text-gray-600" title={`${result.guideProgrammes} programmes à venir dans le guide local`}>
          guide mis à jour {sinceLabel(result.guideFetchedAt)}
        </span>
      )}
    </div>
  )

  if (loading && !result) {
    return (
      <section className="mb-5">
        {header}
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-surface-sunken p-3 text-sm text-gray-400">
          <Spinner size={14} /> Recherche dans les guides… (le premier chargement du guide complet peut
          prendre quelques secondes)
        </div>
      </section>
    )
  }
  if (error) {
    return (
      <section className="mb-5">
        {header}
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} retryLabel="Réessayer" className="py-4" />
      </section>
    )
  }
  if (!result) return null

  return (
    <section className="mb-5">
      {header}
      {result.hits.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-surface-sunken p-3 text-sm text-gray-500">
          Aucun programme à venir ne correspond à « {query} ». Seules les chaînes qui ont un guide sont
          couvertes.
        </p>
      ) : (
        <div className={'space-y-4 ' + (loading ? 'opacity-60' : '')}>
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h3>
              <div className="space-y-1.5">
                {g.items.map((h, i) => {
                  const channel = h.channels[0]!
                  const onAir = h.startSecs <= nowSecs
                  const reminded = reminders.has(channel.streamId, h.startSecs, h.title)
                  // The channel is always reachable, even before the programme starts.
                  const watchTitle = (name: string): string =>
                    onAir ? `Regarder sur ${name}` : `Regarder ${name} maintenant (ce programme n’a pas encore commencé)`
                  return (
                    <div
                      key={`${h.startSecs}-${channel.streamId}-${i}`}
                      className={
                        'flex items-start gap-3 rounded-lg border p-2.5 ' +
                        (onAir ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-surface-sunken')
                      }
                    >
                      <div className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-gray-400">
                        {formatClockFromEpochSecs(h.startSecs)}
                        <div className="text-gray-600">{formatClockFromEpochSecs(h.endSecs)}</div>
                      </div>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={() => onPlayChannel(channel)}
                        title={watchTitle(channel.name)}
                        className="h-9 w-14 shrink-0 overflow-hidden rounded bg-black/30 hover:ring-1 hover:ring-white/30"
                      >
                        <Poster src={channel.icon} alt={channel.name} className="h-full w-full object-contain" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm text-gray-100">
                          <span className="truncate" title={h.title}>
                            {h.title}
                          </span>
                          {onAir && <Badge tone="success">En cours</Badge>}
                        </p>
                        <p className="truncate text-xs text-gray-400">
                          <button
                            type="button"
                            onClick={() => onPlayChannel(channel)}
                            title={watchTitle(channel.name)}
                            className="hover:text-white hover:underline"
                          >
                            {channel.name}
                          </button>
                          {h.channels.length > 1 && (
                            <span className="text-gray-600"> · aussi sur {h.channels.length - 1} autre(s)</span>
                          )}
                        </p>
                        {h.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500" title={h.description}>
                            {h.description}
                          </p>
                        )}
                        {h.channels.length > 1 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {h.channels.map((c) => (
                              <button
                                key={c.streamId}
                                type="button"
                                onClick={() => onPlayChannel(c)}
                                title={watchTitle(c.name)}
                                className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-white/10 hover:text-white"
                              >
                                {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {onAir ? (
                          <Button size="sm" variant="secondary" icon={<IconPlay size={14} />} onClick={() => onPlayChannel(channel)}>
                            Regarder
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant={reminded && reminded.mode !== 'record' ? 'primary' : 'ghost'}
                              title="Rappel à l’approche du programme"
                              onClick={() => void toggleReminder(h, channel, 'notify')}
                            >
                              🔔
                            </Button>
                            <Button
                              size="sm"
                              variant={reminded && reminded.mode !== 'notify' ? 'primary' : 'ghost'}
                              title="Enregistrer ce programme"
                              icon={<IconRecord size={14} />}
                              onClick={() => void toggleReminder(h, channel, 'record')}
                            >
                              <span className="sr-only">Enregistrer</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {result.truncated && (
            <p className="text-xs text-gray-600">Seuls les premiers résultats sont affichés : précisez la recherche.</p>
          )}
        </div>
      )}
    </section>
  )
}
