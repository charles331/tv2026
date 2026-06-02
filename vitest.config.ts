import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest runs the pure-logic unit tests under `test/`. These tests deliberately
 * avoid modules that load native/Electron dependencies (better-sqlite3,
 * electron, the real network) — undici is mocked where needed — so the suite
 * runs anywhere (incl. Linux/WSL2 and CI) without a native rebuild.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/main/lock/**',
        'src/main/ipc/validate.ts',
        'src/main/downloads/helpers.ts',
        'src/main/xtream/XtreamClient.ts',
        'src/renderer/src/lib/format.ts'
      ]
    }
  }
})
