/**
 * SQLite connection + migration runner. Single shared connection for the app.
 * All raw SQL lives in the store/ layer — other modules use the repositories.
 */

import { join } from 'path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { LATEST_VERSION, MIGRATIONS } from './schema'

let db: Database.Database | null = null

/** Resolve the DB file path (userData/tv2026.db). */
function resolveDbPath(): string {
  // app.getPath('userData') is per-OS app data dir; safe + writable.
  return join(app.getPath('userData'), 'tv2026.db')
}

/** Apply pending migrations using the SQLite user_version pragma. */
function migrate(conn: Database.Database): void {
  const current = conn.pragma('user_version', { simple: true }) as number
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      const run = conn.transaction(() => {
        conn.exec(m.up)
        conn.pragma(`user_version = ${m.version}`)
      })
      run()
    }
  }
}

/** Open (or return the existing) database connection and run migrations. */
export function initDatabase(): Database.Database {
  if (db) return db
  const conn = new Database(resolveDbPath())
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  conn.pragma('synchronous = NORMAL')
  migrate(conn)
  db = conn
  return db
}

/** Get the open connection; throws if not initialized. */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first.')
  return db
}

/** Close the connection (graceful shutdown). */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export { LATEST_VERSION }
