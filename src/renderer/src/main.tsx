import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './lib/ipc'
import { startRemote } from './lib/remote/RemoteRuntime'
import './assets/main.css'

// Global renderer error traps → the app journal (visible in Réglages). The
// call is best-effort: if the bridge itself is broken, fail silently.
window.addEventListener('error', (e) => {
  try {
    void api().logs.write('error', 'erreur', `${e.message} @ ${e.filename ?? '?'}:${e.lineno ?? '?'}`)
  } catch {
    // preload bridge unavailable
  }
})
window.addEventListener('unhandledrejection', (e) => {
  try {
    void api().logs.write('error', 'promesse', String(e.reason).slice(0, 500))
  } catch {
    // preload bridge unavailable
  }
})

// Remote-control navigation must be running before any focusable mounts.
startRemote()

const container = document.getElementById('root')
if (!container) throw new Error('#root element not found')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
