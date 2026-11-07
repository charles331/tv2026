/**
 * Movie file quality heuristics, shared by main and renderer.
 *
 * Two independent signals, both available BEFORE downloading:
 *  - a release tag in the provider title ("… CAM", "HDTS"…), free and instant;
 *  - the average bitrate = real file size (probed with a 1-byte Range request)
 *    divided by the runtime. The provider exposes no size/resolution in its
 *    metadata, so this is the only reliable measure; a theatre-recorded copy
 *    is typically well under 1.2 Mbit/s.
 */

/** Release tags meaning "recorded in a theatre" or equivalent. Longest first. */
const LOW_QUALITY_TAGS = ['TELESYNC', 'HDCAM', 'HDTS', 'CAM', 'TS', 'TC'] as const
export type LowQualityTag = (typeof LOW_QUALITY_TAGS)[number]

// Whole-word match only: "Camille" or "Tsunami" must not match.
const TAG_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${LOW_QUALITY_TAGS.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu')

/** Low-quality release tag found in a title, or null. */
export function detectLowQualityTag(name: string | null | undefined): LowQualityTag | null {
  const m = TAG_RE.exec(name ?? '')
  return m ? (m[1]!.toUpperCase() as LowQualityTag) : null
}

/** Average-bitrate thresholds in Mbit/s: below `low` → low, below `medium` → medium. */
export const QUALITY_THRESHOLDS_MBPS = { low: 1.2, medium: 2.5 } as const

export type QualityLevel = 'low' | 'medium' | 'good'

export interface FileQuality {
  level: QualityLevel
  /** Average bitrate in Mbit/s (decimal). */
  mbps: number
}

/** Real picture parameters read from the file itself ("Analyser"). */
export interface VideoInfo {
  width: number
  height: number
  /** mpv/FFmpeg codec name: "hevc", "h264", "av1", "mpeg2video"… */
  codec: string
}

/**
 * Bitrate efficiency vs H.264 (rough, conservative): a modern codec needs much
 * less bitrate for the same picture, so its bitrate is credited accordingly.
 */
const CODEC_EFFICIENCY: Record<string, number> = {
  hevc: 1.6,
  h265: 1.6,
  av1: 2,
  vp9: 1.5,
  h264: 1,
  mpeg4: 0.8,
  mpeg2video: 0.5
}

/** Verdict from the real file size and runtime (+ real codec/resolution when analysed). */
export function fileQuality(
  sizeBytes: number | null | undefined,
  durationSecs: number | null | undefined,
  video?: VideoInfo | null
): FileQuality | null {
  if (!sizeBytes || sizeBytes <= 0 || !durationSecs || durationSecs <= 0) return null
  const mbps = (sizeBytes * 8) / durationSecs / 1e6
  const effective = mbps * (video ? (CODEC_EFFICIENCY[video.codec.toLowerCase()] ?? 1) : 1)
  let level: QualityLevel =
    effective < QUALITY_THRESHOLDS_MBPS.low ? 'low' : effective < QUALITY_THRESHOLDS_MBPS.medium ? 'medium' : 'good'
  // An SD picture is never "good", whatever its bitrate.
  if (video && resolutionLabel(video) === 'SD' && level === 'good') level = 'medium'
  return { level, mbps }
}

/** "4K" / "1080p" / "720p" / "SD" — by width too, so 1920×800 (scope) is 1080p. */
export function resolutionLabel(v: Pick<VideoInfo, 'width' | 'height'>): string {
  if (v.width >= 3200 || v.height >= 2000) return '4K'
  if (v.width >= 1800 || v.height >= 1000) return '1080p'
  if (v.width >= 1200 || v.height >= 700) return '720p'
  return 'SD'
}

const CODEC_LABEL: Record<string, string> = {
  hevc: 'HEVC',
  h265: 'HEVC',
  h264: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2'
}

/** e.g. "1080p · HEVC". */
export function videoLabel(v: VideoInfo): string {
  const c = v.codec.toLowerCase()
  return `${resolutionLabel(v)} · ${CODEC_LABEL[c] ?? c.toUpperCase()}`
}

/** "HH:MM:SS" or "MM:SS" → seconds; null for empty/zero/unparseable. */
export function parseClockDuration(value: string | null | undefined): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(value ?? '')
  if (!m) return null
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return secs > 0 ? secs : null
}
