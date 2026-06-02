import type { ReactElement, ReactNode } from 'react'
import { cn, IconFilm, IconQueue, IconSettings } from './ui'

export type Route = 'catalog' | 'downloads' | 'settings'

export function AppNav({
  route,
  onNavigate,
  activeDownloads,
  busyReason,
  settingsHasUnseen
}: {
  route: Route
  onNavigate: (route: Route) => void
  activeDownloads: number
  busyReason: 'download' | 'playback' | null
  /** Show a "what's new" dot on the Réglages item after an update. */
  settingsHasUnseen?: boolean
}): ReactElement {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-surface-sunken py-4">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent-hover">
        <IconFilm size={20} />
      </div>
      <NavButton
        label="Catalogue"
        active={route === 'catalog'}
        onClick={() => onNavigate('catalog')}
        icon={<IconFilm size={20} />}
      />
      <NavButton
        label="Téléchargements"
        active={route === 'downloads'}
        onClick={() => onNavigate('downloads')}
        icon={<IconQueue size={20} />}
        badge={activeDownloads > 0 ? activeDownloads : undefined}
      />
      <div className="mt-auto" />
      {busyReason && (
        <span
          className={cn(
            'mb-1 h-2 w-2 rounded-full',
            busyReason === 'playback' ? 'bg-amber-400' : 'bg-sky-400'
          )}
          title={
            busyReason === 'playback'
              ? 'Connexion : lecture en cours'
              : 'Connexion : téléchargement'
          }
        />
      )}
      <NavButton
        label={settingsHasUnseen ? 'Réglages — nouveautés disponibles' : 'Réglages'}
        active={route === 'settings'}
        onClick={() => onNavigate('settings')}
        icon={<IconSettings size={20} />}
        dot={settingsHasUnseen}
      />
    </nav>
  )
}

function NavButton({
  label,
  active,
  onClick,
  icon,
  badge,
  dot
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: ReactNode
  badge?: number
  /** Small notification dot (no count), e.g. "what's new". */
  dot?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
        active
          ? 'bg-accent/20 text-accent-hover'
          : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200'
      )}
    >
      {icon}
      {badge != null && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
      {badge == null && dot && (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-surface-sunken bg-accent" />
      )}
    </button>
  )
}
