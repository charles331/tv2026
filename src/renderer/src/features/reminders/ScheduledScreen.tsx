import { useMemo, type ReactElement } from 'react'
import type { Reminder, ReminderStatus } from '@shared/index'
import { useReminders } from '../../lib/reminders'
import {
  Button,
  Badge,
  Poster,
  LoadingState,
  EmptyState,
  IconQueue,
  IconExternal,
  IconX
} from '../../components/ui'

/** Status → French label + Badge tone. */
const STATUS_META: Record<ReminderStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' }> = {
  scheduled: { label: 'Programmé', tone: 'info' },
  notified: { label: 'Notifié', tone: 'accent' },
  recording: { label: 'Enregistrement…', tone: 'danger' },
  completed: { label: 'Terminé', tone: 'success' },
  missed: { label: 'Raté', tone: 'warning' },
  failed: { label: 'Échec', tone: 'danger' },
  canceled: { label: 'Annulé', tone: 'neutral' },
  conflict: { label: 'Conflit (lecture en cours)', tone: 'warning' }
}

const MODE_LABEL = {
  notify: '🔔 Rappel',
  record: '⏺ Enregistrement',
  notify_record: '🔔⏺ Rappel + enregistrement'
} as const

function dateTime(secs: number): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(secs * 1000))
  } catch {
    return ''
  }
}

/** Whether a reminder is still pending/active (not in a terminal state). */
function isActive(r: Reminder): boolean {
  return r.status === 'scheduled' || r.status === 'notified' || r.status === 'recording'
}

function ReminderCard({ r }: { r: Reminder }): ReactElement {
  const reminders = useReminders()
  const meta = STATUS_META[r.status]
  const cancelable = isActive(r) || r.status === 'conflict'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-surface-raised p-3">
      <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-sunken">
        <Poster src={r.channelIcon} alt={r.channelName} className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-gray-100">
          <span className="truncate">{r.title}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </p>
        <p className="mt-0.5 truncate text-xs text-gray-400">
          {r.channelName} · {dateTime(r.startSecs)}
        </p>
        <p className="mt-0.5 text-xs text-gray-600">{MODE_LABEL[r.mode]}</p>
        {r.filePath && (
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-emerald-400">
            <IconExternal size={12} /> <span className="truncate">{r.filePath}</span>
          </p>
        )}
      </div>
      {cancelable && (
        <Button
          size="sm"
          variant="ghost"
          icon={<IconX size={14} />}
          onClick={() => void reminders.cancel(r.id)}
        >
          Annuler
        </Button>
      )}
    </div>
  )
}

/**
 * "Programmés" view — lists reminders & scheduled recordings split into
 * upcoming / in-progress / past, with status badges and cancel. Refreshes live
 * via the reminders provider (which merges reminder:updated events).
 */
export function ScheduledScreen(): ReactElement {
  const { reminders, loading } = useReminders()

  const { upcoming, inProgress, past } = useMemo(() => {
    const up: Reminder[] = []
    const prog: Reminder[] = []
    const old: Reminder[] = []
    for (const r of reminders) {
      if (r.status === 'recording') prog.push(r)
      else if (r.status === 'scheduled' || r.status === 'notified' || r.status === 'conflict') up.push(r)
      else old.push(r)
    }
    up.sort((a, b) => a.startSecs - b.startSecs)
    old.sort((a, b) => b.startSecs - a.startSecs)
    return { upcoming: up, inProgress: prog, past: old }
  }, [reminders])

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState label="Chargement des programmés…" />
      </div>
    )
  }

  if (reminders.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<IconQueue size={36} />}
          title="Rien de programmé"
          description="Ouvrez le guide d’une chaîne (Direct) pour ajouter un rappel 🔔 ou programmer un enregistrement ⏺."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 fade-in">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Programmés</h1>
        <p className="mt-1 text-sm text-gray-400">
          Rappels et enregistrements programmés. Actifs tant que l’application est ouverte.
        </p>
      </header>

      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">En cours</h2>
          {inProgress.map((r) => (
            <ReminderCard key={r.id} r={r} />
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">À venir</h2>
          {upcoming.map((r) => (
            <ReminderCard key={r.id} r={r} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">Passés</h2>
          {past.map((r) => (
            <ReminderCard key={r.id} r={r} />
          ))}
        </section>
      )}
    </div>
  )
}
