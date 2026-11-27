/** Bibliothèque: the video files on disk the app knows about. */

export type LibraryKind = 'movie' | 'episode' | 'recording' | 'file'
export type LibrarySource = 'download' | 'recording' | 'scan' | 'torrent'

export interface LibraryItem {
  id: number
  kind: LibraryKind
  source: LibrarySource
  /** Movie stream id or episode id (null when unknown). */
  streamId: number | null
  seriesId: number | null
  seriesName: string | null
  season: number | null
  episode: number | null
  /** Raw name; shown through displayName. */
  title: string
  image: string | null
  filePath: string
  sizeBytes: number | null
  /** Epoch ms. */
  addedAt: number
  containerExtension: string | null
}

export interface LibraryListing {
  items: LibraryItem[]
  /** Free space of the download folder's disk, null when unknown. */
  freeBytes: number | null
  /** Sum of the items' sizes. */
  usedBytes: number
  /** The configured download folder cannot be found (unplugged drive…). */
  folderMissing: boolean
}

export interface LibraryRefreshResult {
  added: number
  removed: number
  folderMissing: boolean
}
