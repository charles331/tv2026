/**
 * Pure formatting helpers for the renderer UI (French locale).
 * No IPC / no side effects.
 */

/** Format a byte count as a human-readable size, e.g. "4,7 Go". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  const decimals = value >= 100 || i === 0 ? 0 : 1
  return `${value.toFixed(decimals).replace('.', ',')} ${units[i]}`
}

/** Format a transfer speed (bytes/sec) as "4,7 Mo/s". */
export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '—'
  return `${formatBytes(bytesPerSec)}/s`
}

/** Format a duration in seconds as "1 h 42 min" / "42 min 10 s" / "10 s". */
export function formatDuration(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return '—'
  const total = Math.round(secs)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`
  if (m > 0) return `${m} min ${s.toString().padStart(2, '0')} s`
  return `${s} s`
}

/** Format an ETA in seconds as a short "restant" string. */
export function formatEta(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return '—'
  if (secs < 1) return 'quelques instants'
  return formatDuration(secs)
}

/** Format a 0..1 progress ratio as a percentage string, e.g. "47 %". */
export function formatPercent(progress: number | null | undefined): string {
  if (progress == null || !Number.isFinite(progress)) return '—'
  return `${Math.round(progress * 100)} %`
}

/** Format a rating (0..10) as "7,4" or "—". */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return '—'
  return rating.toFixed(1).replace('.', ',')
}

/** Format a Unix epoch (seconds) as a French date, e.g. "12 mars 2026". */
export function formatDateFromEpochSecs(epochSecs: number | null | undefined): string {
  if (epochSecs == null || !Number.isFinite(epochSecs)) return '—'
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date(epochSecs * 1000))
  } catch {
    return '—'
  }
}

/** Format a Unix epoch (seconds) as a short local time, e.g. "20:00" ('' if unknown). */
export function formatClockFromEpochSecs(epochSecs: number | null | undefined): string {
  if (epochSecs == null || !Number.isFinite(epochSecs)) return ''
  try {
    return new Date(epochSecs * 1000).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

/** Format a Unix epoch (seconds) as a French weekday + date + time, e.g. "lun. 3 juin 20:00". */
export function formatDateTimeFromEpochSecs(epochSecs: number | null | undefined): string {
  if (epochSecs == null || !Number.isFinite(epochSecs)) return ''
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(epochSecs * 1000))
  } catch {
    return ''
  }
}

/** Normalize a trailer value (id or url) into a watchable YouTube URL. */
export function trailerUrl(trailer: string | null | undefined): string | null {
  if (!trailer) return null
  const t = trailer.trim()
  if (!t) return null
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  // Assume a bare YouTube video id.
  return `https://www.youtube.com/watch?v=${encodeURIComponent(t)}`
}
