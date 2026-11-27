import { describe, it, expect } from 'vitest'
import {
  isLibraryVideo,
  parseEpisodeName,
  movieTitleKey,
  shouldPrune,
  pathKey,
  pickBackfillRows,
  pruneAnchor
} from '../../src/main/library/libraryLogic'
import { normalizeForSearch } from '../../src/main/store/searchText'

describe('isLibraryVideo', () => {
  it('keeps video files of a real size', () => {
    expect(isLibraryVideo('Dune (2021).mkv', 4e9)).toBe(true)
    expect(isLibraryVideo('Dune.MP4', 2e6)).toBe(true)
  })
  it('drops partial downloads, non-video files, tiny files and disguised executables', () => {
    expect(isLibraryVideo('Dune.mkv.part', 4e9)).toBe(false)
    expect(isLibraryVideo('affiche.jpg', 4e6)).toBe(false)
    expect(isLibraryVideo('sample.mkv', 999_999)).toBe(false)
    expect(isLibraryVideo('film.mkv.exe', 4e9)).toBe(false)
  })
})

describe('parseEpisodeName', () => {
  it('reads the series name, season and episode', () => {
    expect(parseEpisodeName('Breaking Bad S01E02.mkv')).toEqual({ series: 'Breaking Bad', season: 1, episode: 2 })
    expect(parseEpisodeName('the.office.s03e10.mp4')).toEqual({ series: 'the office', season: 3, episode: 10 })
  })
  it('returns null when there is no SxxEyy', () => {
    expect(parseEpisodeName('Dune (2021).mkv')).toBeNull()
  })
})

describe('movieTitleKey', () => {
  it('drops the extension, the FR prefix and the year', () => {
    expect(movieTitleKey('FR - L’Éléphant bleu (2024).mkv')).toEqual({ key: normalizeForSearch('L’Éléphant bleu'), year: 2024 })
    expect(movieTitleKey('Dune.Part.Two.mkv')).toEqual({ key: normalizeForSearch('Dune Part Two'), year: null })
  })
  it('gives a file and its catalogue name the same key, release tags included', () => {
    expect(movieTitleKey('FR - Autre Film (2025) CAM.mp4')).toEqual(movieTitleKey('FR - Autre Film (2025) CAM'))
    expect(movieTitleKey('Autre.Film.2025.1080p.WEB.x264.mkv')).toEqual({ key: normalizeForSearch('Autre Film'), year: 2025 })
  })
})

describe('shouldPrune', () => {
  it('removes a missing file only when its folder is there', () => {
    expect(shouldPrune(false, true)).toBe(true)
    expect(shouldPrune(false, false)).toBe(false)
    expect(shouldPrune(true, true)).toBe(false)
  })
})

describe('pathKey', () => {
  it('ignores case on Windows only', () => {
    expect(pathKey('C:\\DL\\Films\\A.mkv', 'win32')).toBe(pathKey('c:\\dl\\films\\a.mkv', 'win32'))
    expect(pathKey('/dl/A.mkv', 'linux')).not.toBe(pathKey('/dl/a.mkv', 'linux'))
  })
})

describe('pickBackfillRows', () => {
  it('keeps the most recent row per file', () => {
    expect(
      pickBackfillRows([
        { destPath: '/d/a.mkv', completedAt: 1 },
        { destPath: '/d/a.mkv', completedAt: 5 }
      ])
    ).toEqual([{ destPath: '/d/a.mkv', completedAt: 5 }])
  })
})

describe('pruneAnchor', () => {
  it('judges an entry of the download folder by that folder, not by its own subfolder', () => {
    // Films/Dune (2021)/Dune.mkv whose « Dune (2021) » folder was deleted: still prunable.
    expect(pruneAnchor('/dl/Films/Dune (2021)/Dune.mkv', '/dl', 'linux')).toBe('/dl')
  })
  it('judges an entry of an old folder by its drive root', () => {
    expect(pruneAnchor('/old/Films/a.mkv', '/dl', 'linux')).toBe('/')
    expect(pruneAnchor('E:\\old\\a.mkv', 'D:\\dl', 'win32')).toBe('E:\\')
    expect(pruneAnchor('/old/a.mkv', null, 'linux')).toBe('/')
  })
})
