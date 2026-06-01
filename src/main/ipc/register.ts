/**
 * Wires the handler map onto ipcMain.handle and exposes typed event emitters.
 *
 * - Every invoke channel is registered with a uniform wrapper that:
 *     * runs the handler,
 *     * catches ValidationError -> INVALID_INPUT Result,
 *     * catches anything else   -> UNKNOWN Result (never leaks a raw throw).
 * - Event emitters push typed payloads to the focused window's webContents.
 */

import { ipcMain, type BrowserWindow } from 'electron'
import type { EventContract } from '@shared/index'
import { InvokeChannels, EventChannels, err } from '@shared/index'
import { handlers } from './handlers'
import { ValidationError } from './validate'
import { connectionLock } from '../lock/ConnectionLock'

let registered = false

export function registerIpcHandlers(): void {
  if (registered) return
  registered = true

  for (const channel of Object.values(InvokeChannels)) {
    const handler = handlers[channel]
    ipcMain.handle(channel, async (_event, request: unknown) => {
      try {
        // The handler validates its own request shape.
        return await handler(request as never)
      } catch (e) {
        if (e instanceof ValidationError) {
          return err('INVALID_INPUT', e.message)
        }
        console.error(`[ipc] handler "${channel}" threw`, e)
        return err('UNKNOWN', 'Internal error handling the request.')
      }
    })
  }
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(InvokeChannels)) {
    ipcMain.removeHandler(channel)
  }
  registered = false
}

/**
 * Typed event emitter. Domain modules call this to push progress/state events
 * to the renderer. Targets all windows (single-window app in practice).
 */
export function makeEmitter(getWindows: () => BrowserWindow[]) {
  return function emit<C extends keyof EventContract>(
    channel: C,
    payload: EventContract[C]
  ): void {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}

/**
 * Bridge the ConnectionLock's busy-state changes onto the CONNECTION_BUSY event
 * channel so the renderer (and indirectly the user) can see contention.
 */
export function wireConnectionLockEvents(getWindows: () => BrowserWindow[]): () => void {
  const emit = makeEmitter(getWindows)
  return connectionLock.onBusyChange((state) => {
    emit(EventChannels.CONNECTION_BUSY, { busy: state.busy, reason: state.reason })
  })
}
