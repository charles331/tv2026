/**
 * "Actualiser": walks the download folder for video files added by hand and
 * brings the Bibliothèque in line with the disk. Bounded: symbolic links are
 * never followed and every real path stays inside the folder. The database is
 * reached through an injected port, so this module loads without it (tests).
 */
import { existsSync } from 'fs'
import { lstat, readdir, realpath, stat } from 'fs/promises'
import path from 'path'
import type { LibraryItem, LibraryRefreshResult } from '@shared/index'
import type { NewLibraryItem } from '../store/libraryRepo'
import {
  isLibraryVideo,
  movieTitleKey,
  parseEpisodeName,
  pathKey,
  shouldPrune
} from './libraryLogic'

export type TopFolder = 'Films' | 'Séries' | 'Live' | 'root'

export interface ScannedFile {
  path: string
  sizeBytes: number
  top: TopFolder
}

export interface Candidate {
  streamId: number
  name: string
  year: number | null
  image: string | null
}

export interface LibraryRepoPort {
  list(): LibraryItem[]
  upsert(item: NewLibraryItem): unknown
  updateSize(id: number, sizeBytes: number): void
  remove(ids: number[]): void
}

const TOPS: ReadonlySet<string> = new Set(['Films', 'Séries', 'Live'])

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Video files under `root`, recursively; links skipped, unreadable folders skipped. */
export async function listVideoFiles(root: string): Promise<ScannedFile[]> {
  const realRoot = await realpath(root)
  const out: ScannedFile[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable folder: skip it, keep the rest of the scan
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(full)
        if (!isLibraryVideo(entry.name, info.size)) continue
        const real = await realpath(full)
        if (!isInside(real, realRoot)) continue
        const first = path.relative(realRoot, real).split(path.sep)[0] ?? ''
        out.push({
          path: full,
          sizeBytes: info.size,
          top: TOPS.has(first) ? (first as TopFolder) : 'root'
        })
      } catch {
        // vanished or unreadable meanwhile: skip
      }
    }
  }
  await walk(root)
  return out
}

/**
 * The file to play or delete, checked on disk right now: it must exist, be a
 * regular file, not be a link, and not sit behind a linked folder. Else null.
 */
export async function resolveLibraryFile(filePath: string): Promise<string | null> {
  try {
    const info = await lstat(filePath)
    if (info.isSymbolicLink() || !info.isFile()) return null
    const real = await realpath(filePath)
    if (pathKey(real) !== pathKey(filePath)) return null
    return filePath
  } catch {
    return null
  }
}

/** Catalogue movies by title key (built once per refresh, over the whole catalogue). */
export function buildMovieIndex(rows: Candidate[]): Map<string, Candidate[]> {
  const index = new Map<string, Candidate[]>()
  for (const row of rows) {
    const { key } = movieTitleKey(row.name)
    if (!key) continue
    const list = index.get(key)
    if (list) list.push(row)
    else index.set(key, [row])
  }
  return index
}

/** The single catalogue movie a file points to, or null (none or ambiguous). */
export function matchMovie(
  key: { key: string; year: number | null },
  index: Map<string, Candidate[]>
): { streamId: number; image: string | null } | null {
  let found = index.get(key.key) ?? []
  if (key.year !== null) {
    found = found.filter((c) => {
      const year = c.year ?? movieTitleKey(c.name).year
      return year === null || year === key.year
    })
  }
  if (found.length !== 1) return null
  const only = found[0]!
  return { streamId: only.streamId, image: only.image }
}

function bareName(filePath: string): string {
  const base = path.basename(filePath)
  return base.slice(0, base.length - path.extname(base).length) || base
}

function classify(
  file: ScannedFile,
  movieIndex: Map<string, Candidate[]>,
  findSeries: (name: string) => { seriesId: number; image: string | null } | null
): NewLibraryItem {
  const ext = path.extname(file.path).replace(/^\./, '').toLowerCase() || null
  const base: NewLibraryItem = {
    kind: 'file',
    source: 'scan',
    streamId: null,
    seriesId: null,
    seriesName: null,
    season: null,
    episode: null,
    title: bareName(file.path),
    image: null,
    filePath: file.path,
    sizeBytes: file.sizeBytes,
    containerExtension: ext
  }
  if (file.top === 'Live') return { ...base, kind: 'recording' }
  if (file.top === 'Séries') {
    const parsed = parseEpisodeName(path.basename(file.path))
    if (!parsed) return base
    const series = findSeries(parsed.series)
    return {
      ...base,
      kind: 'episode',
      seriesId: series?.seriesId ?? null,
      seriesName: parsed.series,
      season: parsed.season,
      episode: parsed.episode,
      image: series?.image ?? null
    }
  }
  const movie = matchMovie(movieTitleKey(path.basename(file.path)), movieIndex)
  return movie ? { ...base, kind: 'movie', streamId: movie.streamId, image: movie.image } : base
}

export async function scanLibrary(opts: {
  downloadDir: string
  busyKeys: ReadonlySet<string>
  movieIndex: Map<string, Candidate[]>
  findSeries: (name: string) => { seriesId: number; image: string | null } | null
  repo: LibraryRepoPort
}): Promise<LibraryRefreshResult> {
  const { downloadDir, busyKeys, movieIndex, findSeries, repo } = opts
  if (!existsSync(downloadDir)) return { added: 0, removed: 0, folderMissing: true }

  const files = await listVideoFiles(downloadDir)
  const known = new Map(repo.list().map((it) => [pathKey(it.filePath), it]))
  let added = 0
  for (const file of files) {
    const key = pathKey(file.path)
    if (busyKeys.has(key)) continue // still being written
    const entry = known.get(key)
    if (entry) {
      // Known file: only its size may change; never overwrite what a download knew.
      if (entry.sizeBytes !== file.sizeBytes) repo.updateSize(entry.id, file.sizeBytes)
      continue
    }
    repo.upsert(classify(file, movieIndex, findSeries))
    added++
  }

  const gone: number[] = []
  for (const entry of known.values()) {
    if (busyKeys.has(pathKey(entry.filePath))) continue
    if (shouldPrune(existsSync(entry.filePath), existsSync(path.dirname(entry.filePath)))) {
      gone.push(entry.id)
    }
  }
  repo.remove(gone)
  return { added, removed: gone.length, folderMissing: false }
}
