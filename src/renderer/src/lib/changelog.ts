/**
 * Renderer-side "what's new" status.
 *
 * Compares the running app version (from main via `app.info()`) to the last
 * version the user has acknowledged (`settings.lastSeenVersion`) to drive a
 * badge on the Réglages nav item after an update.
 *
 * First-launch rule: when `lastSeenVersion` is null (fresh install), we silently
 * pin it to the current version so a brand-new user never sees a "new" badge for
 * the very first version. The badge only appears after a genuine version bump.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from './ipc'

export interface ChangelogStatus {
  /** Running app version, or null until loaded. */
  version: string | null
  /** True when the current version differs from the last acknowledged one. */
  hasUnseen: boolean
  /** Acknowledge the current version (clears the badge), persisting it. */
  markSeen: () => void
}

export function useChangelogStatus(): ChangelogStatus {
  const [version, setVersion] = useState<string | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([api().app.info(), api().settings.get()]).then(([infoR, setR]) => {
      if (cancelled) return
      const v = infoR.ok ? infoR.data.version : null
      const seen = setR.ok ? setR.data.lastSeenVersion : null
      setVersion(v)
      // Fresh install: pin silently so no badge shows for the first version.
      if (seen == null && v != null) {
        setLastSeen(v)
        void api().settings.set({ lastSeenVersion: v })
      } else {
        setLastSeen(seen)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const markSeen = useCallback(() => {
    if (version == null || version === lastSeen) return
    setLastSeen(version)
    void api().settings.set({ lastSeenVersion: version })
  }, [version, lastSeen])

  const hasUnseen = loaded && version != null && lastSeen != null && version !== lastSeen

  return { version, hasUnseen, markSeen }
}
