/**
 * Deleting a Bibliothèque file: always to the Recycle Bin, never for good.
 * Checks happen in a fixed order and nothing is touched when one fails. The
 * disk, the Recycle Bin and the database are injected (unit-tested).
 */
import type { ErrorCode, LibraryItem } from '@shared/index'
import { pathKey } from './libraryLogic'

export interface RemoveDeps {
  getItem: (id: number) => LibraryItem | null
  /** The file checked on disk now (exists, not a link), or null. */
  resolveFile: (filePath: string) => Promise<string | null>
  /** Played, recorded or downloaded right now (keys from pathKey). */
  isBusy: (key: string) => boolean
  trash: (filePath: string) => Promise<void>
  removeRow: (id: number) => void
}

export interface RemoveOutcome {
  code: ErrorCode | null
  message?: string
}

export async function removeLibraryFile(id: number, deps: RemoveDeps): Promise<RemoveOutcome> {
  const item = deps.getItem(id)
  if (!item) return { code: 'NOT_FOUND', message: 'Ce fichier n’est plus dans la bibliothèque.' }
  const filePath = await deps.resolveFile(item.filePath)
  if (!filePath) {
    return { code: 'INVALID_INPUT', message: 'Fichier introuvable ou remplacé : rien n’a été supprimé.' }
  }
  // Checked last, right before the Recycle Bin, to keep the window small.
  if (deps.isBusy(pathKey(filePath))) {
    return { code: 'BUSY', message: 'Ce fichier est en cours de lecture ou d’écriture.' }
  }
  try {
    await deps.trash(filePath)
  } catch {
    return {
      code: 'TRASH_FAILED',
      message: 'Impossible de mettre le fichier à la Corbeille : rien n’a été supprimé.'
    }
  }
  deps.removeRow(id)
  return { code: null }
}
