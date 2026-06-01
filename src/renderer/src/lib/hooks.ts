/**
 * Reusable renderer hooks: debounced values, async resources, media queries.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from './ipc'

/** Debounce a value by `delayMs` (used for the catalogue search box). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-run the async loader. */
  reload: () => void
}

/**
 * Run an async loader, tracking loading/error state and supporting reload.
 * The loader should throw on failure (use `unwrap` to turn Result -> throw).
 * `deps` controls when it re-runs (like useEffect deps).
 */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(describeError(e))
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

/** Track a CSS media query (used to pick poster grid density). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    if (!window.matchMedia) return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return matches
}
