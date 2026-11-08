/**
 * Quality indicators shown BEFORE downloading: the release tag found in the
 * title ("CAM"…) and the verdict from the real file size (see @shared/quality).
 */
import type { ReactElement } from 'react'
import {
  detectLowQualityTag,
  fileQuality,
  videoLabel,
  type QualityLevel,
  type VideoInfo
} from '@shared/index'
import { formatBytes, formatDuration } from '../../lib/format'
import { Spinner } from '../../components/ui'

const LEVEL: Record<QualityLevel, { label: string; dot: string; pill: string; text: string }> = {
  low: {
    label: 'Très faible qualité',
    dot: 'bg-red-400',
    pill: 'bg-red-500/10 ring-red-400/30',
    text: 'text-red-200'
  },
  medium: {
    label: 'Qualité moyenne',
    dot: 'bg-amber-400',
    pill: 'bg-amber-500/10 ring-amber-400/30',
    text: 'text-amber-200'
  },
  good: {
    label: 'Bonne qualité',
    dot: 'bg-emerald-400',
    pill: 'bg-emerald-500/10 ring-emerald-400/30',
    text: 'text-emerald-200'
  }
}

const HINT: Record<QualityLevel, string> = {
  low: 'probablement une copie CAM, filmée en salle',
  medium: 'fichier très compressé',
  good: 'débit cohérent avec une copie HD'
}

export function formatMbps(mbps: number): string {
  return `${mbps.toFixed(2).replace('.', ',')} Mbit/s`
}

/** Red tag shown when the title carries a low-quality release tag. */
export function LowQualityTag({
  name,
  className = ''
}: {
  name: string | null | undefined
  className?: string
}): ReactElement | null {
  const tag = detectLowQualityTag(name)
  if (!tag) return null
  return (
    <span
      className={`rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wider text-white ${className}`}
      title={`« ${tag} » dans le titre : copie probablement enregistrée en salle`}
    >
      {tag}
    </span>
  )
}

/** Small size label + colored dot on a catalogue poster, once the file was checked. */
export function PosterFileLabel({
  sizeBytes,
  durationSecs,
  video
}: {
  sizeBytes: number | null | undefined
  durationSecs: number | null | undefined
  video?: VideoInfo | null
}): ReactElement | null {
  if (!sizeBytes) return null
  const q = fileQuality(sizeBytes, durationSecs, video)
  return (
    <span
      className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-gray-100 backdrop-blur"
      title={
        q
          ? `${LEVEL[q.level].label} — ${formatMbps(q.mbps)}${video ? ` — ${videoLabel(video)}` : ''}`
          : 'Taille du fichier'
      }
    >
      {q && <span className={`h-1.5 w-1.5 rounded-full ${LEVEL[q.level].dot}`} />}
      {formatBytes(sizeBytes)}
    </span>
  )
}

export type FilePillState =
  | { kind: 'checking' }
  | { kind: 'ok'; sizeBytes: number; durationSecs: number | null; video?: VideoInfo | null }
  | { kind: 'busy' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }

const PILL_BASE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1'

/** One-line file-quality pill under the movie title. */
export function FileQualityPill({
  state,
  onCheck,
  onAnalyze,
  analyzing = false,
  analyzeError = null
}: {
  state: FilePillState
  onCheck: () => void
  /** "Analyser": read the real resolution + codec (offered once the size is known). */
  onAnalyze?: () => void
  analyzing?: boolean
  analyzeError?: string | null
}): ReactElement {
  if (state.kind === 'checking') {
    return (
      <span className={`${PILL_BASE} bg-white/5 text-gray-400 ring-white/10`}>
        <Spinner size={11} /> Vérification du fichier…
      </span>
    )
  }
  if (state.kind === 'ok') {
    const q = fileQuality(state.sizeBytes, state.durationSecs, state.video)
    const analysis = state.video ? (
      <span className="text-gray-300">· {videoLabel(state.video)}</span>
    ) : analyzing ? (
      <span className="inline-flex items-center gap-1 text-gray-400">
        · <Spinner size={10} /> analyse…
      </span>
    ) : onAnalyze ? (
      <>
        <span className="text-gray-400">·</span>
        <button
          type="button"
          onClick={onAnalyze}
          title="Lit le début du fichier (quelques secondes, utilise la connexion) pour connaître sa vraie résolution et son codec, et affiner le verdict"
          className="text-gray-300 underline decoration-dotted underline-offset-2 hover:text-white"
        >
          analyser
        </button>
        {analyzeError && (
          <span className="text-red-300" title={analyzeError}>
            (échec)
          </span>
        )}
      </>
    ) : null
    if (!q) {
      return (
        <span className={`${PILL_BASE} bg-white/5 text-gray-300 ring-white/10`}>
          Taille du fichier : {formatBytes(state.sizeBytes)} {analysis}
        </span>
      )
    }
    const l = LEVEL[q.level]
    return (
      <span
        className={`${PILL_BASE} ${l.pill}`}
        title={`${formatBytes(state.sizeBytes)} pour ${formatDuration(state.durationSecs)} ≈ ${formatMbps(q.mbps)}${
          state.video ? ` en ${videoLabel(state.video)}` : ''
        } : ${HINT[q.level]}${state.video ? '' : ' (verdict basé sur le seul débit : « analyser » pour le préciser)'}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} />
        <span className={`font-medium ${l.text}`}>{l.label}</span>
        <span className="text-gray-400">
          · {formatBytes(state.sizeBytes)} · {formatMbps(q.mbps)}
        </span>
        {analysis}
      </span>
    )
  }
  const { label, title, canCheck } =
    state.kind === 'busy'
      ? {
          label: 'Taille inconnue',
          title: 'La connexion est utilisée par un téléchargement ou une lecture : la vérification se fera dès qu’elle se libère',
          canCheck: false
        }
      : state.kind === 'disabled'
        ? {
            label: 'Qualité non vérifiée',
            title: 'Vérification automatique désactivée (Réglages → Catalogues)',
            canCheck: true
          }
        : { label: 'Vérification impossible', title: state.message, canCheck: true }
  return (
    <span className={`${PILL_BASE} bg-white/5 text-gray-400 ring-white/10`} title={title}>
      <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
      {label} ·
      <button
        type="button"
        onClick={onCheck}
        disabled={!canCheck}
        className="underline decoration-dotted underline-offset-2 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:no-underline"
      >
        vérifier
      </button>
    </span>
  )
}
