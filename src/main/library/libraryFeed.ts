/**
 * Fills the Bibliothèque: a finished download, a finished recording, and once
 * per install the downloads already on disk (download_history). Never throws:
 * a failure is logged and "Actualiser" can still pick the file up later.
 */
import { existsSync, statSync } from 'fs'
import type { DownloadItem } from '@shared/index'
import { catalogRepo, downloadsRepo, libraryRepo, seriesRepo } from '../store'
import { appLog } from '../log/logger'
import { MIN_VIDEO_BYTES, parseEpisodeName, pickBackfillRows } from './libraryLogic'

const BACKFILL_FLAG = 'backfilled'

function sizeOf(filePath: string): number | null {
  try {
    return statSync(filePath).size
  } catch {
    return null
  }
}

/** A download just finished (called before the 'completed' event is sent). */
export function addCompletedDownload(item: DownloadItem): void {
  try {
    const isEpisode = item.kind === 'series'
    const parsed = isEpisode ? parseEpisodeName(item.name) : null
    libraryRepo.upsertLibraryItem({
      kind: isEpisode ? 'episode' : 'movie',
      source: 'download',
      streamId: item.streamId,
      seriesId: isEpisode ? item.seriesId : null,
      seriesName: isEpisode ? (item.seriesName ?? parsed?.series ?? null) : null,
      season: isEpisode ? (item.season ?? parsed?.season ?? null) : null,
      episode: isEpisode ? (item.episodeNum ?? parsed?.episode ?? null) : null,
      title: item.name,
      image: item.image,
      filePath: item.destPath,
      sizeBytes: sizeOf(item.destPath) ?? item.totalBytes,
      containerExtension: item.containerExtension
    })
  } catch (e) {
    appLog.warn('library', `Ajout à la bibliothèque impossible : ${(e as Error).message}`)
  }
}

/** A live recording ended (scheduled or started by hand from the player). */
export function addRecording(filePath: string, title: string): void {
  try {
    const size = sizeOf(filePath)
    if (size === null || size < MIN_VIDEO_BYTES) return
    libraryRepo.upsertLibraryItem({
      kind: 'recording',
      source: 'recording',
      streamId: null,
      seriesId: null,
      seriesName: null,
      season: null,
      episode: null,
      title,
      image: null,
      filePath,
      sizeBytes: size,
      containerExtension: 'ts'
    })
  } catch (e) {
    appLog.warn('library', `Enregistrement non ajouté à la bibliothèque : ${(e as Error).message}`)
  }
}

/**
 * Once per install: the finished downloads still on disk. The flag is set only
 * after a complete run, so a failure retries at the next start (inserts are
 * idempotent). Returns how many entries were written.
 */
export async function backfillLibraryOnce(): Promise<number> {
  try {
    if (libraryRepo.getLibraryFlag(BACKFILL_FLAG) === '1') return 0
    const rows = pickBackfillRows(downloadsRepo.listCompletedHistory())
    let written = 0
    for (const row of rows) {
      if (!existsSync(row.destPath)) continue
      if (libraryRepo.findLibraryItemByPath(row.destPath)) continue
      const size = sizeOf(row.destPath) ?? row.totalBytes
      if (row.kind === 'series') {
        const series = seriesRepo.findSeriesByEpisode(row.streamId)
        const parsed = parseEpisodeName(row.name)
        if (!series && !parsed) {
          libraryRepo.upsertLibraryItem({
            kind: 'file',
            source: 'download',
            streamId: null,
            seriesId: null,
            seriesName: null,
            season: null,
            episode: null,
            title: row.name,
            image: null,
            filePath: row.destPath,
            sizeBytes: size,
            containerExtension: null,
            addedAt: row.completedAt
          })
        } else {
          libraryRepo.upsertLibraryItem({
            kind: 'episode',
            source: 'download',
            streamId: row.streamId,
            seriesId: series?.seriesId ?? null,
            seriesName: series?.name ?? parsed?.series ?? null,
            season: parsed?.season ?? null,
            episode: parsed?.episode ?? null,
            title: row.name,
            image: series?.cover ?? null,
            filePath: row.destPath,
            sizeBytes: size,
            containerExtension: null,
            addedAt: row.completedAt
          })
        }
      } else {
        const movie = catalogRepo.getStream(row.streamId)
        libraryRepo.upsertLibraryItem({
          kind: 'movie',
          source: 'download',
          streamId: row.streamId,
          seriesId: null,
          seriesName: null,
          season: null,
          episode: null,
          title: row.name,
          image: movie?.streamIcon ?? null,
          filePath: row.destPath,
          sizeBytes: size,
          containerExtension: movie?.containerExtension ?? null,
          addedAt: row.completedAt
        })
      }
      written++
    }
    libraryRepo.setLibraryFlag(BACKFILL_FLAG, '1')
    if (written > 0)
      appLog.info('library', `Bibliothèque : ${written} fichier(s) repris de l’historique`)
    return written
  } catch (e) {
    appLog.warn('library', `Reprise de la bibliothèque interrompue : ${(e as Error).message}`)
    return 0
  }
}
