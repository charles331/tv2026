import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import type { EpgEntry, LiveStream } from '@shared/index'
import { api } from '../../lib/ipc'
import { Button, Poster, IconPlay } from '../../components/ui'
import { FavoriteButton } from '../favorites/FavoriteButton'

/** Format an epoch (seconds) as a short local time, e.g. "20:00". */
function clock(secs: number | null): string {
  if (secs == null) return ''
  try {
    return new Date(secs * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * One channel row. The short EPG (now/next) is fetched lazily the first time the
 * row scrolls into view, so we never request the guide for thousands of unseen
 * channels. Results are cached in the main process for 60s.
 */
function LiveChannelRowImpl({
  channel,
  onPlay
}: {
  channel: LiveStream
  onPlay: (channel: LiveStream) => void
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [epg, setEpg] = useState<EpgEntry[] | null>(null)
  const requested = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || requested.current) return
        requested.current = true
        io.disconnect()
        void api()
          .live.epg(channel.streamId, 2)
          .then((r) => setEpg(r.ok ? r.data : []))
          .catch(() => setEpg([]))
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [channel.streamId])

  const now = epg?.find((e) => e.nowPlaying) ?? epg?.[0] ?? null
  const next = epg && now ? epg.find((e) => e !== now) ?? null : null

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface-raised p-3"
    >
      <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-sunken">
        <Poster src={channel.icon} alt={channel.name} className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">
          {channel.number != null && <span className="text-gray-500">{channel.number} · </span>}
          {channel.name}
        </p>
        {now ? (
          <p className="truncate text-xs text-gray-400">
            <span className="text-emerald-400">● </span>
            {now.title}
            {now.endSecs != null && (
              <span className="text-gray-600"> · jusqu’à {clock(now.endSecs)}</span>
            )}
            {next && <span className="text-gray-600"> — puis {next.title}</span>}
          </p>
        ) : (
          <p className="text-xs text-gray-600">{epg === null ? 'Programme…' : 'Pas de guide'}</p>
        )}
      </div>
      <Button size="sm" variant="secondary" icon={<IconPlay size={14} />} onClick={() => onPlay(channel)}>
        Regarder
      </Button>
      <FavoriteButton
        variant="icon"
        req={{
          kind: 'live',
          itemId: channel.streamId,
          name: channel.name,
          image: channel.icon,
          containerExtension: 'ts',
          categoryId: channel.categoryId
        }}
      />
    </div>
  )
}

export const LiveChannelRow = memo(LiveChannelRowImpl)
