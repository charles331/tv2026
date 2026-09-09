import { describe, it, expect, vi } from 'vitest'
import {
  HttpStatusError,
  partPath,
  headerValue,
  parseContentRangeTotal,
  parseContentRangeStart,
  describeError,
  formatBytes,
  renameWithRetry,
  downloadSubfolder,
  clampBlockSize,
  isTransientLockError,
  BLOCK_SIZE_CHOICES,
  BLOCK_SIZE_DEFAULT_BYTES,
  BLOCK_SIZE_MIN_BYTES,
  BLOCK_SIZE_MAX_BYTES
} from '../../src/main/downloads/helpers'

/** Build an errno-style error with a .code, like Node's fs throws. */
function errnoError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException
  e.code = code
  return e
}

describe('partPath', () => {
  it('appends .part to the final path', () => {
    expect(partPath('/dl/Movie (2021).mkv')).toBe('/dl/Movie (2021).mkv.part')
  })
})

describe('downloadSubfolder', () => {
  it('maps each media kind to its library subfolder', () => {
    expect(downloadSubfolder('movie')).toBe('Films')
    expect(downloadSubfolder('series')).toBe('Séries')
    expect(downloadSubfolder('live')).toBe('Live')
  })
})

describe('parseContentRangeStart (garde-fou anti-corruption)', () => {
  it('extracts the start offset', () => {
    expect(parseContentRangeStart('bytes 200-1023/1234')).toBe(200)
    expect(parseContentRangeStart('bytes 0-99/1000')).toBe(0)
  })
  it('tolerates an unknown total', () => {
    expect(parseContentRangeStart('bytes 512-1023/*')).toBe(512)
  })
  it('returns null on malformed / missing input', () => {
    expect(parseContentRangeStart(undefined)).toBeNull()
    expect(parseContentRangeStart('')).toBeNull()
    expect(parseContentRangeStart('garbage')).toBeNull()
  })
})

describe('clampBlockSize', () => {
  const MiB = 1024 * 1024

  it('keeps a size that is already in range', () => {
    expect(clampBlockSize(4 * MiB)).toBe(4 * MiB)
  })

  it('clamps to the allowed range instead of trusting the caller', () => {
    expect(clampBlockSize(1)).toBe(BLOCK_SIZE_MIN_BYTES)
    expect(clampBlockSize(1024 * MiB)).toBe(BLOCK_SIZE_MAX_BYTES)
  })

  it('falls back to the default on a non-finite value', () => {
    expect(clampBlockSize(Number.NaN)).toBe(BLOCK_SIZE_DEFAULT_BYTES)
    expect(clampBlockSize(Number.POSITIVE_INFINITY)).toBe(BLOCK_SIZE_DEFAULT_BYTES)
  })

  it('honours narrower bounds (used by the tests to drive KB-sized blocks)', () => {
    expect(clampBlockSize(4096, 1024, 65536)).toBe(4096)
    expect(clampBlockSize(10, 1024, 65536)).toBe(1024)
  })

  it('offers only sizes that survive clamping, default included', () => {
    for (const c of BLOCK_SIZE_CHOICES) expect(clampBlockSize(c)).toBe(c)
    expect(BLOCK_SIZE_CHOICES).toContain(BLOCK_SIZE_DEFAULT_BYTES)
  })

  it('defaults small: the per-connection burst is collected once per block', () => {
    // A big default would mean one reconnect every ~78 s at ~471 KiB/s, which
    // makes block mode indistinguishable from one long connection.
    expect(BLOCK_SIZE_DEFAULT_BYTES).toBeLessThanOrEqual(4 * MiB)
  })
})

describe('isTransientLockError', () => {
  it('recognises the Windows lock codes an antivirus/indexer produces', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES', 'EMFILE']) {
      expect(isTransientLockError(errnoError(code))).toBe(true)
    }
  })

  it('does not treat a transfer failure as a local lock', () => {
    expect(isTransientLockError(new Error('socket hang up'))).toBe(false)
    expect(isTransientLockError(errnoError('ECONNRESET'))).toBe(false)
    expect(isTransientLockError(null)).toBe(false)
    expect(isTransientLockError(undefined)).toBe(false)
  })
})

describe('headerValue', () => {
  it('returns the first element of a header array', () => {
    expect(headerValue(['a', 'b'])).toBe('a')
  })
  it('passes through a string and undefined', () => {
    expect(headerValue('x')).toBe('x')
    expect(headerValue(undefined)).toBeUndefined()
  })
})

describe('parseContentRangeTotal', () => {
  it('extracts the total from a well-formed Content-Range', () => {
    expect(parseContentRangeTotal('bytes 200-1023/1234')).toBe(1234)
  })
  it('tolerates trailing whitespace', () => {
    expect(parseContentRangeTotal('bytes 0-99/500  ')).toBe(500)
  })
  it('returns null for an unknown total (*) or malformed input', () => {
    expect(parseContentRangeTotal('bytes 0-0/*')).toBeNull()
    expect(parseContentRangeTotal('garbage')).toBeNull()
    expect(parseContentRangeTotal(undefined)).toBeNull()
    expect(parseContentRangeTotal('')).toBeNull()
  })
  it('returns null for a zero total', () => {
    expect(parseContentRangeTotal('bytes 0-0/0')).toBeNull()
  })
})

describe('formatBytes (binary units)', () => {
  it('formats common sizes with one decimal', () => {
    expect(formatBytes(0)).toBe('0.0 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(64 * 1024 * 1024)).toBe('64.0 MiB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GiB')
  })
  it('caps at the largest unit', () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TiB')
  })
})

describe('describeError', () => {
  it('maps auth-ish HTTP statuses to a token/auth message', () => {
    for (const code of [401, 403, 512]) {
      expect(describeError(new HttpStatusError(code))).toMatch(/jeton de téléchargement expiré/)
    }
  })
  it('maps 404 to a not-found message', () => {
    expect(describeError(new HttpStatusError(404))).toMatch(/introuvable/i)
  })
  it('reports other HTTP statuses verbatim', () => {
    expect(describeError(new HttpStatusError(500))).toBe('Le fournisseur a répondu HTTP 500')
  })
  it('maps filesystem errno codes', () => {
    expect(describeError({ code: 'ENOSPC' })).toMatch(/Disque plein/)
    expect(describeError({ code: 'ENOENT' })).toMatch(/introuvable/)
    expect(describeError({ code: 'EACCES' })).toMatch(/Écriture refusée/)
  })
  it('maps undici timeout error names', () => {
    expect(describeError({ name: 'ConnectTimeoutError' })).toMatch(/ne répond pas/)
    expect(describeError({ name: 'HeadersTimeoutError' })).toMatch(/ne répond pas/)
  })
  it('falls back to the error message, then a generic message', () => {
    expect(describeError(new Error('socket hang up'))).toBe(
      'Erreur de téléchargement : socket hang up'
    )
    expect(describeError(null)).toBe('Erreur de téléchargement inconnue')
    expect(describeError({})).toBe('Erreur de téléchargement inconnue')
  })
})

describe('renameWithRetry', () => {
  const noSleep = (): Promise<void> => Promise.resolve()

  it('succeeds on the first try without sleeping', async () => {
    const renameFn = vi.fn().mockResolvedValue(undefined)
    const sleepFn = vi.fn(noSleep)
    await renameWithRetry('a.part', 'a', { renameFn, sleepFn })
    expect(renameFn).toHaveBeenCalledTimes(1)
    expect(renameFn).toHaveBeenCalledWith('a.part', 'a')
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('retries on a transient EBUSY then succeeds', async () => {
    const renameFn = vi
      .fn()
      .mockRejectedValueOnce(errnoError('EBUSY'))
      .mockRejectedValueOnce(errnoError('EBUSY'))
      .mockResolvedValueOnce(undefined)
    const sleepFn = vi.fn(noSleep)
    await renameWithRetry('a.part', 'a', { renameFn, sleepFn })
    expect(renameFn).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenCalledTimes(2) // one sleep between each retry
  })

  it('also retries EPERM and EACCES', async () => {
    for (const code of ['EPERM', 'EACCES']) {
      const renameFn = vi
        .fn()
        .mockRejectedValueOnce(errnoError(code))
        .mockResolvedValueOnce(undefined)
      await renameWithRetry('a.part', 'a', { renameFn, sleepFn: noSleep })
      expect(renameFn).toHaveBeenCalledTimes(2)
    }
  })

  it('gives up after `attempts` on a persistent transient error', async () => {
    const renameFn = vi.fn().mockRejectedValue(errnoError('EBUSY'))
    const sleepFn = vi.fn(noSleep)
    await expect(
      renameWithRetry('a.part', 'a', { attempts: 4, renameFn, sleepFn })
    ).rejects.toMatchObject({ code: 'EBUSY' })
    expect(renameFn).toHaveBeenCalledTimes(4)
    expect(sleepFn).toHaveBeenCalledTimes(3) // no sleep after the final failed attempt
  })

  it('does NOT retry a non-transient error (e.g. ENOSPC)', async () => {
    const renameFn = vi.fn().mockRejectedValue(errnoError('ENOSPC'))
    const sleepFn = vi.fn(noSleep)
    await expect(renameWithRetry('a.part', 'a', { renameFn, sleepFn })).rejects.toMatchObject({
      code: 'ENOSPC'
    })
    expect(renameFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('uses exponential backoff capped at maxDelayMs', async () => {
    const renameFn = vi.fn().mockRejectedValue(errnoError('EBUSY'))
    const delays: number[] = []
    const sleepFn = vi.fn((ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    })
    await expect(
      renameWithRetry('a.part', 'a', {
        attempts: 6,
        baseDelayMs: 100,
        maxDelayMs: 500,
        renameFn,
        sleepFn
      })
    ).rejects.toMatchObject({ code: 'EBUSY' })
    expect(delays).toEqual([100, 200, 400, 500, 500]) // doubles then caps at 500
  })
})
