/**
 * Tests for the WHOLE-download retry policy. The rule that makes automatic
 * retries safe is "progress resets the budget", so it is asserted directly here
 * rather than inferred from the manager's behaviour.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_NO_PROGRESS_ATTEMPTS,
  RETRY_BACKOFF_MS,
  classifyFailure,
  formatDelay,
  nextRetryState,
  type RetryState
} from '../../src/main/downloads/retryPolicy'
import { IntegrityError, HttpStatusError } from '../../src/main/downloads/helpers'

function errnoError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException
  e.code = code
  return e
}

describe('classifyFailure', () => {
  it('retries provider-side faults — a restart re-resolves the signed URL', () => {
    // The single most common real failure: the download token expired.
    expect(classifyFailure(new HttpStatusError(401))).toBe('retryable')
    expect(classifyFailure(new HttpStatusError(403))).toBe('retryable')
    expect(classifyFailure(new HttpStatusError(404))).toBe('retryable')
    expect(classifyFailure(new HttpStatusError(500))).toBe('retryable')
    expect(classifyFailure(new HttpStatusError(503))).toBe('retryable')
  })

  it('retries network faults', () => {
    expect(classifyFailure(errnoError('ECONNRESET'))).toBe('retryable')
    expect(classifyFailure(errnoError('ETIMEDOUT'))).toBe('retryable')
    expect(
      // What undici throws when the provider cuts a response short.
      classifyFailure(new Error('Response body length does not match content-length header'))
    ).toBe('retryable')
  })

  it('NEVER auto-retries an integrity error', () => {
    // These mean the bytes on disk and the bytes now served disagree. Retrying
    // would append fresh bytes onto a stale prefix and corrupt the movie.
    expect(classifyFailure(new IntegrityError('la taille annoncée a changé'))).toBe('fatal')
  })

  it('does not retry local write problems the user must fix', () => {
    expect(classifyFailure(errnoError('ENOSPC'))).toBe('fatal')
    expect(classifyFailure(errnoError('EACCES'))).toBe('fatal')
    expect(classifyFailure(errnoError('EPERM'))).toBe('fatal')
    expect(classifyFailure(errnoError('EROFS'))).toBe('fatal')
    expect(classifyFailure(errnoError('ENOENT'))).toBe('fatal')
  })
})

describe('nextRetryState', () => {
  const NOW = 1_000_000

  it('schedules the first attempt quickly (token expiry is repaired for free)', () => {
    const d = nextRetryState(undefined, 0, NOW)
    expect(d.action).toBe('retry')
    expect(d.delayMs).toBe(RETRY_BACKOFF_MS[0])
    expect(d.state.attempts).toBe(1)
    expect(d.state.retryAt).toBe(NOW + RETRY_BACKOFF_MS[0]!)
  })

  it('backs off further on each attempt that moves no bytes', () => {
    let st: RetryState | undefined
    const delays: number[] = []
    for (let i = 0; i < MAX_NO_PROGRESS_ATTEMPTS; i++) {
      const d = nextRetryState(st, 500, NOW)
      expect(d.action).toBe('retry')
      delays.push(d.delayMs)
      st = d.state
    }
    // First call has no prior state, so it counts as "progress" and starts at 1.
    expect(delays).toEqual(RETRY_BACKOFF_MS.slice(0, MAX_NO_PROGRESS_ATTEMPTS))
    expect(st!.attempts).toBe(MAX_NO_PROGRESS_ATTEMPTS)
  })

  it('gives up after the no-progress budget is spent', () => {
    let st: RetryState | undefined
    let last = nextRetryState(st, 500, NOW)
    st = last.state
    for (let i = 0; i < MAX_NO_PROGRESS_ATTEMPTS; i++) {
      last = nextRetryState(st, 500, NOW)
      st = last.state
    }
    expect(last.action).toBe('give-up')
  })

  // ---- THE rule: a download that keeps inching forward never gives up ----

  it('resets the budget whenever bytes advanced', () => {
    let st = nextRetryState(undefined, 1000, NOW).state
    st = nextRetryState(st, 1000, NOW).state // no progress -> 2
    st = nextRetryState(st, 1000, NOW).state // no progress -> 3
    expect(st.attempts).toBe(3)

    const d = nextRetryState(st, 5000, NOW) // moved 4000 bytes
    expect(d.progressed).toBe(true)
    expect(d.action).toBe('retry')
    expect(d.state.attempts).toBe(1)
    expect(d.delayMs).toBe(RETRY_BACKOFF_MS[0])
  })

  it('survives far more hiccups than the budget as long as it progresses', () => {
    let st: RetryState | undefined
    let bytes = 0
    for (let i = 0; i < MAX_NO_PROGRESS_ATTEMPTS * 25; i++) {
      bytes += 1 // one byte of progress is still progress
      const d = nextRetryState(st, bytes, NOW)
      expect(d.action).toBe('retry')
      st = d.state
    }
    expect(st!.attempts).toBe(1)
  })

  it('treats a stalled transfer as no progress even after earlier success', () => {
    let st = nextRetryState(undefined, 100, NOW).state
    st = nextRetryState(st, 900, NOW).state // progressed -> 1
    expect(st.attempts).toBe(1)
    // Now it stops moving entirely.
    for (let i = 2; i <= MAX_NO_PROGRESS_ATTEMPTS; i++) {
      const d = nextRetryState(st, 900, NOW)
      expect(d.progressed).toBe(false)
      st = d.state
      expect(st.attempts).toBe(i)
    }
    expect(nextRetryState(st, 900, NOW).action).toBe('give-up')
  })

  it('honours a smaller budget (used to keep tests fast)', () => {
    let st = nextRetryState(undefined, 0, NOW, 2).state
    st = nextRetryState(st, 0, NOW, 2).state
    expect(nextRetryState(st, 0, NOW, 2).action).toBe('give-up')
  })

  it('never indexes past the backoff table', () => {
    const st: RetryState = {
      attempts: RETRY_BACKOFF_MS.length + 50,
      bytesAtLastAttempt: 0,
      retryAt: 0
    }
    const d = nextRetryState(st, 0, NOW, Number.MAX_SAFE_INTEGER)
    expect(d.delayMs).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
  })
})

describe('formatDelay', () => {
  it('reads naturally in the queue row and the journal', () => {
    expect(formatDelay(3_000)).toBe('3 s')
    expect(formatDelay(45_000)).toBe('45 s')
    expect(formatDelay(180_000)).toBe('3 min')
    expect(formatDelay(300_000)).toBe('5 min')
  })
})
