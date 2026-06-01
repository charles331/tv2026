/**
 * Typed repository for the `settings` key/value table.
 * Stores only non-secret app settings (AppSettings). Credentials never go here.
 */

import type { AppSettings } from '@shared/index'
import { DEFAULT_SETTINGS } from '@shared/index'
import { getDb } from './db'

/** Read all settings, merged over defaults. */
export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value)
    } catch {
      stored[r.key] = r.value
    }
  }
  // Merge defaults <- stored, then re-pin constraint-locked fields.
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored as Partial<AppSettings>),
    maxConcurrentDownloads: 1,
    pauseDownloadsWhilePlaying: true
  }
  return merged
}

/** Patch settings (only provided keys are written). Returns the merged result. */
export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, JSON.stringify(value))
    }
  })
  // Never let callers override the constraint-locked fields.
  const safePatch = { ...patch }
  delete (safePatch as Partial<AppSettings>).maxConcurrentDownloads
  delete (safePatch as Partial<AppSettings>).pauseDownloadsWhilePlaying
  tx(Object.entries(safePatch))
  return getSettings()
}
