import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import {
  listVideoFiles,
  resolveLibraryFile,
  buildMovieIndex,
  matchMovie,
  scanLibrary
} from '../../src/main/library/scanLibrary'
import { movieTitleKey } from '../../src/main/library/libraryLogic'

const MB2 = Buffer.alloc(2_000_000)
let root: string
let outside: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tv2026-lib-'))
  outside = await mkdtemp(join(tmpdir(), 'tv2026-out-'))
  await mkdir(join(root, 'Films'), { recursive: true })
  await mkdir(join(root, 'Séries', 'S'), { recursive: true })
  await writeFile(join(root, 'Films', 'a.mkv'), MB2)
  await writeFile(join(root, 'Films', 'a.mkv.part'), MB2)
  await writeFile(join(root, 'Films', 'b.txt'), MB2)
  await writeFile(join(root, 'Films', 'petit.mkv'), Buffer.alloc(10))
  await writeFile(join(outside, 'x.mkv'), MB2)
  await symlink(join(outside, 'x.mkv'), join(root, 'Films', 'lien.mkv'))
  await symlink(outside, join(root, 'Films', 'dossier-lien'))
  await writeFile(join(root, 'Séries', 'S', 'x S01E01.mkv'), MB2)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('listVideoFiles', () => {
  it('keeps real video files and never follows links out of the folder', async () => {
    const files = await listVideoFiles(root)
    expect(files.map((f) => basename(f.path)).sort()).toEqual(['a.mkv', 'x S01E01.mkv'])
    expect(files.find((f) => basename(f.path) === 'x S01E01.mkv')?.top).toBe('Séries')
    expect(files.find((f) => basename(f.path) === 'a.mkv')?.top).toBe('Films')
  })
})

describe('resolveLibraryFile', () => {
  it('returns a real file, refuses a link or a missing file', async () => {
    expect(await resolveLibraryFile(join(root, 'Films', 'a.mkv'))).toBe(join(root, 'Films', 'a.mkv'))
    expect(await resolveLibraryFile(join(root, 'Films', 'lien.mkv'))).toBeNull()
    expect(await resolveLibraryFile(join(root, 'Films', 'absent.mkv'))).toBeNull()
    expect(await resolveLibraryFile(join(root, 'Films', 'dossier-lien', 'x.mkv'))).toBeNull()
  })
})

describe('matchMovie', () => {
  const idx = buildMovieIndex([
    { streamId: 1, name: 'FR - Dune (2021)', year: 2021, image: 'i1' },
    { streamId: 2, name: 'FR - Dune (1984)', year: 1984, image: 'i2' }
  ])
  it('finds the one catalogue movie a file name points to', () => {
    expect(matchMovie(movieTitleKey('Dune (2021).mkv'), idx)).toEqual({ streamId: 1, image: 'i1' })
    expect(matchMovie(movieTitleKey('Dune.2021.1080p.mkv'), idx)).toEqual({ streamId: 1, image: 'i1' })
  })
  it('gives up when the name fits several movies', () => {
    expect(matchMovie(movieTitleKey('Dune.mkv'), idx)).toBeNull()
  })
})

describe('scanLibrary', () => {
  it('touches nothing when the download folder is missing', async () => {
    let touched = false
    const repo = {
      list: () => ((touched = true), []),
      upsert: () => ((touched = true), undefined),
      updateSize: () => void (touched = true),
      remove: () => void (touched = true)
    }
    expect(
      await scanLibrary({
        downloadDir: join(root, 'n-existe-pas'),
        busyKeys: new Set(),
        movieIndex: new Map(),
        findSeries: () => null,
        repo
      })
    ).toEqual({ added: 0, removed: 0, folderMissing: true })
    expect(touched).toBe(false)
  })
})
