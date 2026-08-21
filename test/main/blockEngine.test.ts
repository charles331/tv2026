/**
 * Integration tests for the BLOCK download engine, against a real local HTTP
 * server with KB-sized payloads. These cover the integrity rules that protect a
 * user's multi-GB file: no block is ever appended at the wrong offset, a
 * truncated result never reports 'done' with a full total, and a mid-download
 * HTTP 200 (expired token / error page) is treated as an error rather than as
 * "ranges unsupported".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Agent, request } from 'undici'
import { runBlockDownload, type BlockRequestFn } from '../../src/main/downloads/blockEngine'
import { IntegrityError, HttpStatusError } from '../../src/main/downloads/helpers'

/** Deterministic payload: any misplaced/duplicated byte changes the content. */
function payload(size: number): Buffer {
  const b = Buffer.alloc(size)
  for (let i = 0; i < size; i++) b[i] = i % 251
  return b
}

interface ServerBehaviour {
  /** Force this status for the Nth request (1-indexed). */
  statusForRequest?: Record<number, number>
  /** Omit Content-Range on the Nth request. */
  omitContentRangeOn?: number
  /** Answer the Nth request with a wrong range start (off by this many bytes). */
  wrongStartOn?: { nth: number; delta: number }
  /** Report a different total from the Nth request on. */
  totalChangesFrom?: { nth: number; total: number }
  /** Cut the body after N bytes (simulates a dropped connection) on the Nth request. */
  cutAfterOn?: { nth: number; bytes: number }
  /** Ignore the end bound and stream the whole tail, without Content-Length. */
  unboundedOn?: number
  /** Body for a forced 200 (e.g. an HTML error page). */
  errorPageBody?: string
  /** Delay (ms) before answering the Nth request — makes blocks finish out of order. */
  delayMsFor?: (n: number) => number
}

const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()))
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function startServer(
  content: Buffer,
  behaviour: ServerBehaviour = {}
): Promise<{ url: string; requests: () => number }> {
  let n = 0
  const srv = createServer((req, res) => {
    n++
    const forced = behaviour.statusForRequest?.[n]
    if (forced === 200) {
      const body = behaviour.errorPageBody ?? 'error'
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(body.length) })
      return res.end(body)
    }
    if (forced && forced !== 206) {
      res.writeHead(forced)
      return res.end()
    }

    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '')
    if (!m) {
      res.writeHead(200, { 'content-length': String(content.length) })
      return res.end(content)
    }
    const start = Number(m[1])
    const end = Math.min(Number(m[2]), content.length - 1)

    if (behaviour.unboundedOn === n) {
      // Ignore the end bound AND omit Content-Length (chunked encoding).
      res.writeHead(206, { 'content-range': `bytes ${start}-${content.length - 1}/${content.length}` })
      return res.end(content.subarray(start))
    }

    const total =
      behaviour.totalChangesFrom && n >= behaviour.totalChangesFrom.nth
        ? behaviour.totalChangesFrom.total
        : content.length
    const reportedStart =
      behaviour.wrongStartOn?.nth === n ? start + behaviour.wrongStartOn.delta : start
    const slice = content.subarray(start, end + 1)
    const headers: Record<string, string> = { 'content-length': String(slice.length) }
    if (behaviour.omitContentRangeOn !== n) {
      headers['content-range'] = `bytes ${reportedStart}-${end}/${total}`
    }
    res.writeHead(206, headers)

    if (behaviour.cutAfterOn?.nth === n) {
      res.write(slice.subarray(0, behaviour.cutAfterOn.bytes))
      return res.destroy() // drop the connection mid-body
    }
    const delay = behaviour.delayMsFor?.(n) ?? 0
    if (delay > 0) return void setTimeout(() => res.end(slice), delay)
    res.end(slice)
  })
  servers.push(srv)
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}/movie.mkv`, requests: () => n }
}

async function tempPart(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tv2026-block-'))
  dirs.push(dir)
  return join(dir, 'movie.mkv.part')
}

/** undici-backed request adapter, mirroring the app's wiring. */
function makeRequest(agent: Agent): BlockRequestFn {
  return async (url, init) => {
    const res = await request(url, {
      method: 'GET',
      dispatcher: agent,
      headers: { 'user-agent': 'tv2026-test', accept: '*/*', ...init.headers },
      signal: init.signal
    })
    return {
      statusCode: res.statusCode,
      headers: res.headers as Record<string, string | string[] | undefined>,
      body: res.body as never
    }
  }
}

async function run(
  url: string,
  part: string,
  over: Partial<Parameters<typeof runBlockDownload>[0]> = {}
): ReturnType<typeof runBlockDownload> {
  const agent = new Agent()
  try {
    return await runBlockDownload({
      url,
      partPath: part,
      startOffset: 0,
      knownTotal: null,
      signal: new AbortController().signal,
      request: makeRequest(agent),
      initialChunkBytes: 4096,
      minChunkBytes: 1024,
      maxChunkBytes: 65536,
      interBlockDelayMs: 0,
      sleep: async () => undefined,
      ...over
    })
  } finally {
    await agent.close()
  }
}

describe('runBlockDownload — chemin nominal', () => {
  it('downloads a file in several blocks, byte-exact', async () => {
    const content = payload(10_000) // ~3 blocks of 4096
    const { url, requests } = await startServer(content)
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('done')
    expect(res.totalBytes).toBe(content.length)
    expect(await readFile(part)).toEqual(content)
    expect(requests()).toBeGreaterThan(1) // really used several blocks
  })

  it('resumes from an existing .part without re-downloading it', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content)
    const part = await tempPart()
    await writeFile(part, content.subarray(0, 6000))

    const res = await run(url, part, { startOffset: 6000 })

    expect(res.outcome).toBe('done')
    expect(await readFile(part)).toEqual(content)
  })

  it('honours the total it latched (last block fetches the final byte)', async () => {
    const content = payload(4097) // one full block + exactly 1 byte
    const { url } = await startServer(content)
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('done')
    expect((await readFile(part)).length).toBe(4097)
  })
})

describe('runBlockDownload — garde-fous d’intégrité', () => {
  it('REFUSES a block whose Content-Range start does not match (no corruption)', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { wrongStartOn: { nth: 2, delta: 512 } })
    const part = await tempPart()

    await expect(run(url, part)).rejects.toBeInstanceOf(IntegrityError)
    // Only the first, verified block was written — nothing spliced at the wrong offset.
    const written = await readFile(part)
    expect(written).toEqual(content.subarray(0, written.length))
  })

  it('falls back instead of appending when Content-Range is unusable', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { omitContentRangeOn: 2 })
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('fallback')
    // The unverifiable block was NOT appended.
    const written = await readFile(part)
    expect(written.length).toBe(4096)
    expect(written).toEqual(content.subarray(0, 4096))
  })

  it('aborts when the remote total changes mid-download (two different files)', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { totalChangesFrom: { nth: 2, total: 99_999 } })
    const part = await tempPart()

    await expect(run(url, part)).rejects.toBeInstanceOf(IntegrityError)
  })

  it('treats a mid-download HTTP 200 as a server ERROR, never as "no range support"', async () => {
    // Regression guard: the old code fell back to the continuous engine here,
    // which deleted the .part and could finalize the error page as the movie.
    const content = payload(10_000)
    const { url } = await startServer(content, {
      statusForRequest: { 2: 200 },
      errorPageBody: '<html>token expired</html>'
    })
    const part = await tempPart()

    await expect(run(url, part)).rejects.toBeInstanceOf(HttpStatusError)
    // The bytes already downloaded are still there, untouched.
    const written = await readFile(part)
    expect(written.length).toBe(4096)
    expect(written).toEqual(content.subarray(0, 4096))
  })

  it('DOES fall back when the very first request shows ranges are unsupported', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { statusForRequest: { 1: 200 } })
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('fallback')
    expect(res.totalBytes).toBeNull()
  })
})

describe('runBlockDownload — robustesse réseau', () => {
  it('retries a block cut mid-body and still ends byte-exact', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { cutAfterOn: { nth: 1, bytes: 1000 } })
    const part = await tempPart()

    const res = await run(url, part, { maxBlockRetries: 3 })

    expect(res.outcome).toBe('done')
    expect(await readFile(part)).toEqual(content)
  })

  it('hands over when the server ignores the end bound (unbounded stream)', async () => {
    const content = payload(40_000)
    const { url } = await startServer(content, { unboundedOn: 1 })
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('fallback')
    // Whatever was written stays a contiguous prefix — safe to resume from.
    const written = await readFile(part)
    expect(written).toEqual(content.subarray(0, written.length))
  })

  it('hands over on a rate-limit status instead of hammering', async () => {
    const content = payload(10_000)
    const { url } = await startServer(content, { statusForRequest: { 2: 429 } })
    const part = await tempPart()

    const res = await run(url, part)

    expect(res.outcome).toBe('fallback')
    expect(res.reason).toMatch(/limitation/)
  })

  it('stops promptly when interrupted (pause) and keeps a contiguous .part', async () => {
    const content = payload(40_000)
    const { url } = await startServer(content)
    const part = await tempPart()
    let blocks = 0

    await expect(
      run(url, part, {
        onBlockDone: () => {
          blocks++
        },
        interruptReason: () => (blocks >= 1 ? 'paused' : null),
        makeInterruptError: (reason) => {
          const e = new Error(reason)
          e.name = 'TransferInterrupt'
          return e
        }
      })
    ).rejects.toMatchObject({ name: 'TransferInterrupt' })

    const written = await readFile(part)
    expect(written.length).toBeGreaterThan(0)
    expect(written).toEqual(content.subarray(0, written.length))
  })

  it('respects the block budget (never unbounded request counts)', async () => {
    const content = payload(50_000)
    const { url, requests } = await startServer(content)
    const part = await tempPart()

    const res = await run(url, part, { initialChunkBytes: 4096, maxBlocks: 2 })

    // 50 kB needs ~13 blocks of 4 kB, but the budget stops at 2 → fallback.
    expect(res.outcome).toBe('fallback')
    expect(res.reason).toMatch(/plafond/)
    expect(requests()).toBeLessThanOrEqual(3)
  })
})

describe('runBlockDownload — connexions parallèles', () => {
  it('is byte-exact even when blocks come back OUT OF ORDER', async () => {
    const content = payload(40_000)
    // Make the FIRST block of each wave the slowest, so later blocks finish
    // first: the engine must still append in offset order.
    const { url, requests } = await startServer(content, {
      delayMsFor: (n) => (n % 3 === 1 ? 120 : 5)
    })
    const part = await tempPart()

    const res = await run(url, part, { connections: 3 })

    expect(res.outcome).toBe('done')
    expect(await readFile(part)).toEqual(content)
    expect(requests()).toBeGreaterThan(3) // really went parallel
  })

  it('produces the same bytes with 1, 2 and 4 connections', async () => {
    const content = payload(30_000)
    for (const connections of [1, 2, 4]) {
      const { url } = await startServer(content)
      const part = await tempPart()
      const res = await run(url, part, { connections })
      expect(res.outcome, `connections=${connections}`).toBe('done')
      expect(await readFile(part), `connections=${connections}`).toEqual(content)
    }
  })

  it('resumes correctly in parallel mode from a partial .part', async () => {
    const content = payload(40_000)
    const { url } = await startServer(content)
    const part = await tempPart()
    await writeFile(part, content.subarray(0, 9000))

    const res = await run(url, part, { connections: 3, startOffset: 9000 })

    expect(res.outcome).toBe('done')
    expect(await readFile(part)).toEqual(content)
  })

  it('stops the parallel path on an unusable answer, keeping a contiguous prefix', async () => {
    const content = payload(40_000)
    // Request 1 latches the total sequentially; a later one returns 429.
    const { url } = await startServer(content, { statusForRequest: { 4: 429 } })
    const part = await tempPart()

    const res = await run(url, part, { connections: 3 })

    expect(res.outcome).toBe('fallback')
    const written = await readFile(part)
    expect(written).toEqual(content.subarray(0, written.length))
  })

  it('never buffers more than the memory cap, whatever the block size', async () => {
    // 8 connections x a huge requested block must be clamped so RAM stays bounded.
    const content = payload(50_000)
    const { url } = await startServer(content)
    const part = await tempPart()

    const res = await run(url, part, {
      connections: 8,
      initialChunkBytes: 8192,
      maxChunkBytes: 64 * 1024 * 1024
    })

    expect(res.outcome).toBe('done')
    expect(await readFile(part)).toEqual(content)
  })
})
