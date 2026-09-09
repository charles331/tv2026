/**
 * Retry policy for a WHOLE download.
 *
 * The engines already retry inside one transfer (a block's network hiccup, a
 * Windows file lock). This module governs the layer above: what to do when a
 * transfer dies anyway. Before it existed, any such error ended the download in
 * `failed` and required a manual click — even though the bytes on disk are kept
 * and the provider URL is re-resolved on every (re)start, so a plain restart
 * fixes the most common causes (expired download token, provider hiccup, a
 * connection reset mid-stream).
 *
 * Everything here is PURE so the policy is unit-tested rather than inferred from
 * behaviour: `classifyFailure` decides whether restarting can possibly help, and
 * `nextRetryState` implements the rule that actually makes this safe —
 * PROGRESS RESETS THE BUDGET. A download that keeps inching forward may retry
 * indefinitely; only consecutive attempts that move ZERO bytes count against the
 * budget, so a genuinely dead item still stops instead of looping forever.
 */

import { IntegrityError, HttpStatusError } from './helpers'

/**
 * Delay before each successive no-progress attempt. The FIRST one is short on
 * purpose: an expired signed URL is the most common failure and is repaired for
 * free by re-resolving it, so there is no reason to make the user wait.
 */
export const RETRY_BACKOFF_MS = [3_000, 5_000, 10_000, 20_000, 45_000, 90_000, 180_000, 300_000]

/**
 * Consecutive attempts that transferred NOTHING before giving up. Attempts that
 * moved bytes do not count, so this is a "no longer making progress" budget, not
 * a cap on how many hiccups one download may survive.
 */
export const MAX_NO_PROGRESS_ATTEMPTS = RETRY_BACKOFF_MS.length

export type FailureClass =
  /** Restarting the transfer can plausibly succeed (URL is re-resolved, .part is kept). */
  | 'retryable'
  /** Restarting cannot help, or would be unsafe. Surface it to the user. */
  | 'fatal'

/** Local conditions where retrying is pointless until the USER acts. */
const FATAL_ERRNO = new Set(['ENOSPC', 'ENOENT', 'EACCES', 'EPERM', 'EROFS'])

/**
 * Decide whether an automatic restart is worth attempting.
 *
 * Deliberately permissive: provider-side and network faults are all treated as
 * transient because the `.part` is preserved and the budget above stops a
 * hopeless item anyway. Two families are excluded:
 *
 *  - **Integrity errors.** These mean the bytes on disk and the bytes the server
 *    is now serving disagree (the file changed on the provider, a range came
 *    back at the wrong offset, the finished size did not match). Auto-retrying an
 *    integrity failure is precisely the wrong instinct: it would append fresh
 *    bytes onto a stale prefix and quietly corrupt the movie. The user is told
 *    instead.
 *  - **Local write problems** (disk full, permission denied, path gone). Nothing
 *    changes until the user frees space or fixes the destination.
 */
export function classifyFailure(e: unknown): FailureClass {
  if (e instanceof IntegrityError) return 'fatal'

  const err = e as NodeJS.ErrnoException | undefined
  if (typeof err?.code === 'string' && FATAL_ERRNO.has(err.code)) return 'fatal'

  // Any HTTP status the engines did not already handle: expired token (401/403),
  // gone (404), panel error (5xx), throttling. All plausibly transient — and a
  // permanently missing file is caught by the no-progress budget.
  if (e instanceof HttpStatusError) return 'retryable'

  return 'retryable'
}

/** Per-download retry bookkeeping (in memory: a restart is a deliberate fresh chance). */
export interface RetryState {
  /** Consecutive attempts that transferred nothing. */
  attempts: number
  /** `receivedBytes` observed when the last attempt ended. */
  bytesAtLastAttempt: number
  /** Epoch ms when the next attempt becomes due. */
  retryAt: number
}

export interface RetryDecision {
  /** 'retry' → re-arm the item; 'give-up' → mark it failed. */
  action: 'retry' | 'give-up'
  state: RetryState
  /** Delay applied before the next attempt (0 when giving up). */
  delayMs: number
  /** True when this attempt moved bytes, so the budget was reset. */
  progressed: boolean
}

/**
 * Fold one failure into the retry state.
 *
 * `receivedBytes` is read from the FILE, not the DB, by the caller — that is what
 * makes "did we make progress" trustworthy even when a transfer died in an
 * unexpected place.
 */
export function nextRetryState(
  prev: RetryState | undefined,
  receivedBytes: number,
  now: number,
  maxAttempts = MAX_NO_PROGRESS_ATTEMPTS
): RetryDecision {
  const before = prev?.bytesAtLastAttempt ?? -1
  // First failure for this item counts as progress only if bytes actually exist;
  // either way the budget starts fresh.
  const progressed = prev === undefined ? true : receivedBytes > before

  const attempts = progressed ? 1 : (prev?.attempts ?? 0) + 1

  if (attempts > maxAttempts) {
    return {
      action: 'give-up',
      state: { attempts, bytesAtLastAttempt: receivedBytes, retryAt: now },
      delayMs: 0,
      progressed
    }
  }

  const delayMs = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]!
  return {
    action: 'retry',
    state: { attempts, bytesAtLastAttempt: receivedBytes, retryAt: now + delayMs },
    delayMs,
    progressed
  }
}

/** Human-readable delay for the journal and the queue row ("45 s", "3 min"). */
export function formatDelay(ms: number): string {
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs} s`
  const mins = Math.round(secs / 60)
  return `${mins} min`
}
