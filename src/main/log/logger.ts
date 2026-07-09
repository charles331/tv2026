/**
 * appLog — the app's lightweight journal (main process singleton).
 *
 * Two sinks, both bounded so logging can never bloat the app:
 *  - an in-memory ring buffer (last 1000 entries) that feeds the Réglages
 *    viewer over IPC;
 *  - a small on-disk file (userData/logs/tv2026.log, rotated to .old at 1 MiB)
 *    that survives crashes/restarts for after-the-fact diagnosis.
 *
 * Every message is scrubbed of credentials/stream secrets before storage
 * (scrub.ts) and bounded to one line. Writes are best-effort: a logging
 * failure must never break the app (all fs errors are swallowed).
 */

import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ListLogsRequest, LogEntry, LogLevel } from '@shared/index'
import { boundMessage, scrubSecrets } from './scrub'

const MAX_BUFFER_ENTRIES = 1000
const MAX_FILE_BYTES = 1024 * 1024 // 1 MiB, then rotate to .old

class AppLogger {
  private readonly buffer: LogEntry[] = []
  private nextId = 1
  private dirPath: string | null = null

  /** Resolve (and create) the log directory; null when unavailable (tests). */
  logDir(): string | null {
    if (this.dirPath) return this.dirPath
    try {
      const dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
      this.dirPath = dir
      return dir
    } catch {
      return null
    }
  }

  info(scope: string, message: string): void {
    this.write('info', scope, message)
  }

  warn(scope: string, message: string): void {
    this.write('warn', scope, message)
  }

  error(scope: string, message: string): void {
    this.write('error', scope, message)
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const entry: LogEntry = {
      id: this.nextId++,
      tsMs: Date.now(),
      level,
      scope,
      message: boundMessage(scrubSecrets(String(message)))
    }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_ENTRIES)
    }
    this.appendToFile(entry)
  }

  /** Recent entries, chronological; newest kept when `limit` trims. */
  list(req: ListLogsRequest = {}): LogEntry[] {
    const limit = req.limit && req.limit > 0 ? Math.trunc(req.limit) : 500
    const filtered =
      req.level && req.level !== 'all'
        ? this.buffer.filter((e) => e.level === req.level)
        : this.buffer
    return filtered.slice(-limit)
  }

  /** Empty the buffer and reset the on-disk file. */
  clear(): void {
    this.buffer.length = 0
    const dir = this.logDir()
    if (!dir) return
    try {
      writeFileSync(join(dir, 'tv2026.log'), '')
    } catch {
      // best-effort
    }
  }

  private appendToFile(e: LogEntry): void {
    const dir = this.logDir()
    if (!dir) return
    const file = join(dir, 'tv2026.log')
    const line = `${new Date(e.tsMs).toISOString()}\t${e.level.toUpperCase()}\t[${e.scope}]\t${e.message}\n`
    try {
      appendFileSync(file, line, 'utf8')
      if (statSync(file).size > MAX_FILE_BYTES) {
        // Keep exactly one previous generation.
        renameSync(file, join(dir, 'tv2026.old.log'))
      }
    } catch {
      // best-effort — never let logging break the app
    }
  }
}

/** Singleton shared across the main process. */
export const appLog = new AppLogger()
