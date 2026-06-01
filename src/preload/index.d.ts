/** Ambient declaration so the renderer sees a typed window.api. */
import type { RendererApi } from '@shared/index'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
