import { describe, it, expect } from 'vitest'
import { removeLibraryFile, type RemoveDeps } from '../../src/main/library/removeLibraryFile'
import type { LibraryItem } from '../../src/shared/types/library'

const item = { id: 7, filePath: '/dl/Films/Dune.mkv' } as LibraryItem

function deps(over: Partial<RemoveDeps> = {}): RemoveDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    getItem: () => item,
    resolveFile: async (p) => p,
    isBusy: () => false,
    trash: async () => void calls.push('trash'),
    removeRow: (id) => void calls.push(`remove:${id}`),
    ...over
  }
}

describe('removeLibraryFile', () => {
  it('refuses an unknown entry without touching the disk', async () => {
    const d = deps({ getItem: () => null })
    expect((await removeLibraryFile(7, d)).code).toBe('NOT_FOUND')
    expect(d.calls).toEqual([])
  })
  it('refuses a file that is gone or was replaced by a link', async () => {
    const d = deps({ resolveFile: async () => null })
    expect((await removeLibraryFile(7, d)).code).toBe('INVALID_INPUT')
    expect(d.calls).toEqual([])
  })
  it('refuses a file being played, recorded or downloaded', async () => {
    const d = deps({ isBusy: () => true })
    expect((await removeLibraryFile(7, d)).code).toBe('BUSY')
    expect(d.calls).toEqual([])
  })
  it('keeps the entry and deletes nothing when the Recycle Bin fails', async () => {
    const d = deps({
      trash: async () => {
        throw new Error('no trash')
      }
    })
    expect((await removeLibraryFile(7, d)).code).toBe('TRASH_FAILED')
    expect(d.calls).toEqual([])
  })
  it('sends the file to the Recycle Bin, then forgets the entry', async () => {
    const d = deps()
    expect((await removeLibraryFile(7, d)).code).toBeNull()
    expect(d.calls).toEqual(['trash', 'remove:7'])
  })
})
