/**
 * Journal entries for catalogue refreshes (films, séries, chaînes): one line on
 * success with the counts and duration, one error line on failure (the error is
 * rethrown unchanged). Before this, a failed refresh only showed a toast and
 * left no trace — the frozen catalogue of 2026-11-05 went unnoticed for days.
 */
import { appLog } from '../log/logger'

export async function withRefreshLog<T>(
  scope: string,
  label: string,
  run: () => Promise<T>,
  summary: (result: T) => string,
  now: () => number = Date.now
): Promise<T> {
  const started = now()
  try {
    const result = await run()
    const secs = Math.round((now() - started) / 100) / 10
    appLog.info(scope, `${label} mis à jour : ${summary(result)} en ${secs} s`)
    return result
  } catch (e) {
    appLog.error(scope, `${label} non mis à jour : ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }
}
