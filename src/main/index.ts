/**
 * Main process entry point.
 *
 * Responsibilities:
 *  - Single-instance lock (provider allows 1 connection; 1 app instance too).
 *  - Create the BrowserWindow with hardened security settings.
 *  - Initialize the SQLite store + run migrations + reconcile interrupted state.
 *  - Register the typed IPC handlers and event wiring.
 *  - Graceful shutdown (release the connection lock, close the DB).
 */

import { join } from 'path'
import { app, BrowserWindow, session, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, downloadsRepo } from './store'
import {
  registerIpcHandlers,
  unregisterIpcHandlers,
  wireConnectionLockEvents,
  makeEmitter
} from './ipc/register'
import { connectionLock } from './lock/ConnectionLock'
import { downloadManager } from './downloads/DownloadManager'
import { playerController } from './player/PlayerController'
import { initAutoUpdates } from './updater'

let mainWindow: BrowserWindow | null = null
let unwireLock: (() => void) | null = null

/** Restrictive CSP applied to every renderer response. */
function installCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // No remote code; allow self + inline styles (Tailwind injects a <style>).
    // 'unsafe-inline' for styles only; scripts are strictly self.
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // Posters come from the provider over http(s); allow remote images + data URIs.
      "img-src 'self' data: http: https:",
      "media-src 'self'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'none'"
    ].join('; ')
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: 'TV2026',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // --- security hardening ---
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Never leave an orphan mpv process when the window goes away.
  mainWindow.on('closed', () => {
    playerController.disposeForShutdown()
    mainWindow = null
  })

  // Block in-app navigation to remote origins; open external links in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = is.dev && process.env['ELECTRON_RENDERER_URL']
    if (!(isDevServer && url.startsWith(process.env['ELECTRON_RENDERER_URL']!))) {
      event.preventDefault()
    }
  })

  // Load renderer: dev server URL in dev, built file in prod.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getWindows(): BrowserWindow[] {
  return mainWindow ? [mainWindow] : []
}

// --- single-instance lock ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('be.speos.tv2026')

    // Initialize store + reconcile any download left mid-flight by a crash.
    initDatabase()
    downloadsRepo.reconcileOnStartup()

    installCsp()
    registerIpcHandlers()
    unwireLock = wireConnectionLockEvents(getWindows)

    // Wire the download engine: typed event emitter + start the sequential queue.
    // Items left 'paused' by reconcileOnStartup are resumable on demand; queued
    // items (e.g. enqueued just before quit) resume automatically.
    downloadManager.attachEmitter(makeEmitter(getWindows))
    downloadManager.start()

    // Wire the mpv player: typed event emitter. mpv renders in its own video
    // window. Playback acquires the connection lock; the download queue pauses
    // while the player holds it (handled in DownloadManager via the lock).
    playerController.attach(makeEmitter(getWindows))

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    // Check GitHub Releases for a newer version (packaged builds only).
    initAutoUpdates()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Graceful shutdown: release the shared connection, tear down IPC + DB.
app.on('before-quit', () => {
  playerController.disposeForShutdown()
  downloadManager.stop()
  unwireLock?.()
  connectionLock.reset()
  unregisterIpcHandlers()
  closeDatabase()
})
