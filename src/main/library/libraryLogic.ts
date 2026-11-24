/**
 * Pure rules of the Bibliothèque (no disk, no database): which files count as
 * videos, how a file name maps to an episode or to a catalogue title, how paths
 * compare, when a missing entry may be removed. Unit-tested; the scanner, the
 * feeds and the IPC handlers build on these.
 */
import path from 'path'
import { displayName } from '@shared/displayName'
import { normalizeForSearch } from '../store/searchText'

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.m4v',
  '.mov',
  '.ts',
  '.webm',
  '.wmv',
  '.mpg',
  '.mpeg'
])

/** Smaller files are samples or broken leftovers, not something to watch. */
export const MIN_VIDEO_BYTES = 1_000_000

/** Words dropped from the end of a title (release tags), case-insensitive. */
export const RELEASE_TAGS: ReadonlySet<string> = new Set(
  (
    'cam ts hdcam vost vostfr vf vff truefrench french multi subfrench 4k uhd hdr hdr10 dv ' +
    '2160p 1080p 720p 480p x264 x265 h264 h265 hevc web webrip webdl bluray brrip dvdrip hdtv remux'
  ).split(' ')
)

export function isLibraryVideo(fileName: string, sizeBytes: number): boolean {
  // extname looks at the LAST extension only: "film.mkv.part" / "film.mkv.exe" fail.
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase()) && sizeBytes >= MIN_VIDEO_BYTES
}

function withoutVideoExtension(name: string): string {
  const ext = path.extname(name)
  return VIDEO_EXTENSIONS.has(ext.toLowerCase()) ? name.slice(0, -ext.length) : name
}

const EPISODE = /^(.+?)[\s._-]+s(\d{1,2})e(\d{1,3})\b/i

/** "Breaking Bad S01E02.mkv" → { series: 'Breaking Bad', season: 1, episode: 2 }. */
export function parseEpisodeName(
  name: string
): { series: string; season: number; episode: number } | null {
  const m = EPISODE.exec(withoutVideoExtension(name))
  if (!m) return null
  const series = m[1].replace(/[._]+/g, ' ').trim()
  if (!series) return null
  return { series, season: Number(m[2]), episode: Number(m[3]) }
}

const YEAR = /\(?\b((?:19|20)\d{2})\b\)?/g

/**
 * Comparable key of a movie title, for a file name as well as a catalogue name:
 * no video extension, no FR prefix, dots/underscores as spaces, the year taken
 * apart (the last one; what follows it is release noise), trailing release
 * tags dropped, then the search normalisation.
 */
export function movieTitleKey(fileName: string): { key: string; year: number | null } {
  let title = displayName(withoutVideoExtension(fileName)).replace(/[._]+/g, ' ')
  let year: number | null = null
  const years = [...title.matchAll(YEAR)]
  const last = years[years.length - 1]
  if (last && last.index !== undefined) {
    const before = title.slice(0, last.index)
    // A title that IS a year ("2012", "1917") keeps it.
    if (normalizeForSearch(before) !== '') {
      year = Number(last[1])
      title = before
    }
  }
  const words = normalizeForSearch(title).split(' ').filter(Boolean)
  while (words.length > 1 && RELEASE_TAGS.has(words[words.length - 1])) words.pop()
  return { key: words.join(' '), year }
}

/** Entry whose file is gone: remove it only if its folder is reachable. */
export function shouldPrune(fileExists: boolean, folderExists: boolean): boolean {
  return !fileExists && folderExists
}

/** Path identity for comparisons: resolved, and case-insensitive on Windows. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return path.win32.resolve(p).toLowerCase()
  return path.posix.resolve(p)
}

/** The most recent row per file (download history may hold a file twice). */
export function pickBackfillRows<T extends { destPath: string; completedAt: number }>(
  rows: T[]
): T[] {
  const latest = new Map<string, T>()
  for (const row of rows) {
    const key = pathKey(row.destPath)
    const seen = latest.get(key)
    if (!seen || row.completedAt > seen.completedAt) latest.set(key, row)
  }
  return [...latest.values()]
}
