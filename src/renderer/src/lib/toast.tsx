/**
 * Minimal in-app toast notifications.
 *
 * A ToastProvider at the app root holds a small queue; useToast() exposes a
 * `show()` helper, and <Toaster/> renders them bottom-right with auto-dismiss.
 * Used e.g. to confirm a long action completed ("catalogues à jour").
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { cn } from '../components/ui'

export type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone, durationMs?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'info', durationMs = 6000) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, tone, message }])
      if (durationMs > 0) window.setTimeout(() => dismiss(id), durationMs)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cn(
              'pointer-events-auto fade-in rounded-lg border px-4 py-3 text-left text-sm shadow-lg backdrop-blur',
              t.tone === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
                : t.tone === 'error'
                  ? 'border-red-500/30 bg-red-500/15 text-red-100'
                  : 'border-white/15 bg-surface-overlay text-gray-100'
            )}
            title="Masquer"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
