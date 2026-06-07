import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { EpgEntry, LiveStream, ReminderMode } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'
import { useReminders } from '../../lib/reminders'
import { useToast } from '../../lib/toast'
import { formatClockFromEpochSecs } from '../../lib/format'
import {
  Button,
  Poster,
  Badge,
  LoadingState,
  EmptyState,
  ErrorState,
  IconX,
  IconPlay,
  IconBroadcast,
  IconRecord
} from '../../components/ui'

/** A French day header, e.g. "Aujourd'hui" / "Lundi 9 juin". */
function dayLabel(secs: number): string {
  const d = new Date(secs * 1000)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(d, today)) return "Aujourd'hui"
  if (sameDay(d, tomorrow)) return 'Demain'
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(d)
  } catch {
    return ''
  }
}

/** Group programmes by calendar day (keyed by local YYYY-MM-DD). */
function groupByDay(entries: EpgEntry[]): { key: string; label: string; items: EpgEntry[] }[] {
  const groups = new Map<string, { label: string; items: EpgEntry[] }>()
  for (const e of entries) {
    if (e.startSecs == null) continue
    const d = new Date(e.startSecs * 1000)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const g = groups.get(key)
    if (g) g.items.push(e)
    else groups.set(key, { label: dayLabel(e.startSecs), items: [e] })
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, items: g.items }))
}

/**
 * Full programme guide for one channel: programmes grouped by day, the current
 * one highlighted, with per-programme "Rappel" and "Enregistrer" actions. Opened
 * as an overlay from a live channel row.
 */
export function ChannelGuide({
  channel,
  onClose,
  onPlay
}: {
  channel: LiveStream
  onClose: () => void
  onPlay: (channel: LiveStream) => void
}): ReactElement {
  const [epg, setEpg] = useState<EpgEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reminders = useReminders()
  const toast = useToast()

  const load = useMemo(
    () => async (): Promise<void> => {
      setError(null)
      setEpg(null)
      try {
        setEpg(unwrap(await api().live.fullEpg(channel.streamId)))
      } catch (e) {
        setError(describeError(e))
      }
    },
    [channel.streamId]
  )

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => (epg ? groupByDay(epg) : []), [epg])
  const nowSecs = Math.floor(Date.now() / 1000)

  const handleAdd = async (e: EpgEntry, mode: ReminderMode): Promise<void> => {
    if (e.startSecs == null || e.endSecs == null) return
    const existing = reminders.has(channel.streamId, e.startSecs, e.title)
    if (existing) {
      await reminders.cancel(existing.id)
      toast.show(`Rappel annulé : « ${e.title} »`, 'info')
      return
    }
    const r = await reminders.add({
      streamId: channel.streamId,
      channelName: channel.name,
      channelIcon: channel.icon,
      epgId: e.epgId,
      title: e.title,
      description: e.description,
      startSecs: e.startSecs,
      endSecs: e.endSecs,
      mode
    })
    if (r) {
      toast.show(
        mode === 'notify'
          ? `Rappel ajouté : « ${e.title} »`
          : `Enregistrement programmé : « ${e.title} »`,
        'success'
      )
    } else {
      toast.show('Impossible d’ajouter le rappel.', 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fade-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-raised shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-sunken">
            <Poster src={channel.icon} alt={channel.name} className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-white">{channel.name}</h2>
            <p className="text-xs text-gray-500">Guide des programmes</p>
          </div>
          <Button size="sm" variant="secondary" icon={<IconPlay size={14} />} onClick={() => onPlay(channel)}>
            Regarder
          </Button>
          <Button size="sm" variant="ghost" icon={<IconX size={16} />} onClick={onClose} aria-label="Fermer">
            <span className="sr-only">Fermer</span>
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} retryLabel="Réessayer" />
          ) : epg === null ? (
            <LoadingState label="Chargement du guide…" />
          ) : epg.length === 0 ? (
            <EmptyState
              icon={<IconBroadcast size={36} />}
              title="Pas de guide"
              description="Le fournisseur ne renvoie pas de programme pour cette chaîne."
            />
          ) : (
            <div className="space-y-5">
              {days.map((day) => (
                <div key={day.key}>
                  <h3 className="sticky top-0 z-10 mb-2 bg-surface-raised py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {day.label}
                  </h3>
                  <div className="space-y-1.5">
                    {day.items.map((e, i) => {
                      const isNow =
                        e.nowPlaying ||
                        (e.startSecs != null &&
                          e.endSecs != null &&
                          nowSecs >= e.startSecs &&
                          nowSecs < e.endSecs)
                      const isPast = e.endSecs != null && nowSecs >= e.endSecs
                      const reminded =
                        e.startSecs != null
                          ? reminders.has(channel.streamId, e.startSecs, e.title)
                          : undefined
                      return (
                        <div
                          key={`${e.startSecs}-${i}`}
                          className={
                            'flex items-start gap-3 rounded-lg border p-2.5 ' +
                            (isNow
                              ? 'border-emerald-500/40 bg-emerald-500/10'
                              : isPast
                                ? 'border-white/5 bg-surface-sunken/40 opacity-60'
                                : 'border-white/10 bg-surface-sunken')
                          }
                        >
                          <div className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-gray-400">
                            {formatClockFromEpochSecs(e.startSecs)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm text-gray-100">
                              <span className="truncate">{e.title}</span>
                              {isNow && <Badge tone="success">En cours</Badge>}
                            </p>
                            {e.description && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                                {e.description}
                              </p>
                            )}
                          </div>
                          {!isPast && (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant={reminded && reminded.mode !== 'record' ? 'primary' : 'ghost'}
                                title="Rappel à l’approche du programme"
                                onClick={() => void handleAdd(e, 'notify')}
                              >
                                🔔
                              </Button>
                              <Button
                                size="sm"
                                variant={
                                  reminded && reminded.mode !== 'notify' ? 'primary' : 'ghost'
                                }
                                title="Enregistrer ce programme"
                                icon={<IconRecord size={14} />}
                                onClick={() => void handleAdd(e, 'record')}
                              >
                                <span className="sr-only">Enregistrer</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
