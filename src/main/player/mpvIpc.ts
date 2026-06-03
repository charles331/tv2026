/**
 * MpvIpc — a thin, robust client for mpv's JSON IPC protocol.
 *
 * mpv exposes a control channel via `--input-ipc-server=<path>`:
 *   - Windows: a named pipe (e.g. \\.\pipe\tv2026-mpv-<pid>)
 *   - POSIX:   a unix domain socket
 * Both are reachable with `net.connect(path)` from Node, giving a duplex stream
 * of newline-delimited JSON. We deliberately drive the socket directly rather
 * than depending on `node-mpv`:
 *   - one less dependency to keep in sync with mpv/Electron,
 *   - identical code path on Windows (named pipe) and POSIX (unix socket),
 *   - full control over reconnection, command IDs, and property observation,
 *     which is what makes the lifecycle reliable cross-platform.
 *
 * Protocol summary (newline-delimited JSON, UTF-8):
 *   request : { "command": [...], "request_id": <n> }
 *   reply   : { "request_id": <n>, "error": "success"|<msg>, "data": <any> }
 *   event   : { "event": "property-change", "id": <obsId>, "name", "data" }
 *             { "event": "end-file", ... } etc.
 */

import { EventEmitter } from 'events'
import { connect, type Socket } from 'net'

interface PendingReply {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface MpvPropertyChange {
  name: string
  data: unknown
}

export interface MpvEndFile {
  reason?: string
}

/**
 * Typed events emitted by MpvIpc:
 *   'property-change' (MpvPropertyChange) — an observed property changed.
 *   'end-file'        (MpvEndFile)        — current file ended (eof/error/stop).
 *   'event'           (record)            — any other raw mpv event.
 *   'close'           ()                  — the IPC socket closed.
 *   'error'           (Error)             — socket/parse error (non-fatal log).
 */
export class MpvIpc extends EventEmitter {
  private socket: Socket | null = null
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, PendingReply>()
  private closed = false

  constructor(private readonly ipcPath: string) {
    super()
  }

  /**
   * Connect to mpv's IPC server, retrying briefly while mpv finishes creating
   * the pipe/socket (it is created shortly after spawn). Rejects if mpv never
   * comes up within the budget.
   */
  async connect(timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    // Retry loop: the server endpoint appears a moment after mpv spawns.
    while (true) {
      try {
        await this.tryConnectOnce()
        return
      } catch (e) {
        if (Date.now() >= deadline) throw e
        await delay(120)
      }
    }
  }

  private tryConnectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = connect(this.ipcPath)
      const onError = (err: Error): void => {
        sock.removeListener('connect', onConnect)
        sock.destroy()
        reject(err)
      }
      const onConnect = (): void => {
        sock.removeListener('error', onError)
        this.attach(sock)
        resolve()
      }
      sock.once('error', onError)
      sock.once('connect', onConnect)
    })
  }

  private attach(sock: Socket): void {
    this.socket = sock
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => this.onData(chunk))
    sock.on('error', (err) => this.emit('error', err))
    sock.on('close', () => {
      if (this.closed) return
      this.closed = true
      this.failAllPending(new Error('mpv IPC closed'))
      this.emit('close')
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        // mpv occasionally emits non-JSON noise; ignore defensively.
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.request_id === 'number') {
      const pending = this.pending.get(msg.request_id)
      if (pending) {
        this.pending.delete(msg.request_id)
        clearTimeout(pending.timer)
        if (msg.error && msg.error !== 'success') {
          pending.reject(new Error(`mpv command error: ${String(msg.error)}`))
        } else {
          pending.resolve(msg.data)
        }
      }
      return
    }
    const event = msg.event
    if (event === 'property-change') {
      this.emit('property-change', { name: String(msg.name), data: msg.data } as MpvPropertyChange)
    } else if (event === 'end-file') {
      this.emit('end-file', { reason: msg.reason as string | undefined } as MpvEndFile)
    } else if (typeof event === 'string') {
      this.emit('event', msg)
    }
  }

  /** Send a command array and await mpv's reply. Rejects on error/timeout. */
  command(args: unknown[], timeoutMs = 5000): Promise<unknown> {
    if (!this.socket || this.closed) {
      return Promise.reject(new Error('mpv IPC is not connected'))
    }
    const id = this.nextId++
    const payload = JSON.stringify({ command: args, request_id: id }) + '\n'
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('mpv command timed out'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.write(payload, (err) => {
        if (err) {
          const p = this.pending.get(id)
          if (p) {
            this.pending.delete(id)
            clearTimeout(p.timer)
          }
          reject(err)
        }
      })
    })
  }

  /** Set a property (`set_property`). */
  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command(['set_property', name, value])
  }

  /** Get a property (`get_property`). */
  getProperty(name: string): Promise<unknown> {
    return this.command(['get_property', name])
  }

  /** Observe a property; subsequent changes arrive as 'property-change'. */
  observeProperty(id: number, name: string): Promise<unknown> {
    return this.command(['observe_property', id, name])
  }

  /** Whether the IPC channel is usable. */
  isConnected(): boolean {
    return this.socket !== null && !this.closed
  }

  /** Close the socket and fail any outstanding commands. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.failAllPending(new Error('mpv IPC disposed'))
    this.socket?.destroy()
    this.socket = null
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
