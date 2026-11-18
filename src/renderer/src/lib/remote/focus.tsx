/**
 * React building blocks of the remote-control navigation, on top of Norigin.
 *
 * - useFocusItem: makes one element selectable. OK clicks it (Norigin blocks
 *   Enter's native action), a mouse press selects it too, and it scrolls into
 *   view when selected. `data-remote-focus` drives the selection ring (CSS).
 * - FocusZone: a group (menu, sidebar, toolbar, overlay) that remembers its
 *   last selected child; `boundary` keeps the selection inside (overlays).
 * - useBackHandler: registers a Back handler while mounted (the latest wins).
 * - useReturnFocus: an overlay gives the selection back to whatever had it
 *   before it opened.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  FocusContext,
  useFocusable,
  getCurrentFocusKey,
  doesFocusableExist,
  setFocus,
  ROOT_FOCUS_KEY,
  type Direction
} from '@noriginmedia/norigin-spatial-navigation'
import { backStack } from './backStack'

/**
 * False inside a screen that is kept mounted but hidden (App's ScreenSlot):
 * nothing there may take the selection or keep a menu open.
 */
export const ScreenActiveContext = createContext(true)

export interface FocusItemOptions {
  focusKey?: string
  /** OK pressed; default: click the element. */
  onEnter?: () => void
  /** Arrow pressed while selected; return false to keep the selection here. */
  onArrow?: (dir: Direction) => boolean
  focusable?: boolean
  onFocus?: () => void
}

// Norigin's onArrowPress gives the direction as a plain string.
const asDirection = (d: string): Direction => d as Direction

export function useFocusItem<E extends HTMLElement = HTMLElement>(opts: FocusItemOptions = {}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const { ref, focused, focusSelf, focusKey } = useFocusable<object, E>({
    focusKey: opts.focusKey,
    focusable: opts.focusable ?? true,
    onEnterPress: () => {
      const onEnter = optsRef.current.onEnter
      if (onEnter) onEnter()
      else ref.current?.click()
    },
    onArrowPress: (dir) => optsRef.current.onArrow?.(asDirection(dir)) ?? true,
    onFocus: () => {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      optsRef.current.onFocus?.()
    }
  })
  return {
    ref,
    focused,
    focusKey,
    focusSelf,
    itemProps: {
      'data-remote-focus': focused,
      'data-remote': '',
      onMouseDown: () => focusSelf()
    }
  }
}

/** Keys of the mounted FocusZones (read by the key router, see RemoteRuntime). */
export const zoneKeys = new Set<string>()

export function FocusZone({
  focusKey,
  boundary = false,
  preferredChildFocusKey,
  focusable = true,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  focusKey: string
  boundary?: boolean
  preferredChildFocusKey?: string
  focusable?: boolean
  className?: string
  children: ReactNode
}): ReactElement {
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    trackChildren: true,
    saveLastFocusedChild: true,
    isFocusBoundary: boundary,
    preferredChildFocusKey,
    focusable
  })
  useEffect(() => {
    zoneKeys.add(focusKey)
    return () => {
      zoneKeys.delete(focusKey)
    }
  }, [focusKey])
  return (
    <FocusContext.Provider value={focusKey}>
      <div {...rest} ref={ref} className={className} data-focus-zone={focusKey}>
        {children}
      </div>
    </FocusContext.Provider>
  )
}

/**
 * Gives the selection to `target` once `ready` (e.g. the first page of a list
 * arrived) — only if nothing better is selected: the selection is still on
 * the screen zone itself (it had no children yet), on nothing, or on a
 * focusable that no longer exists.
 */
export function useFocusWhenReady(target: string, ready: boolean, scope: string): void {
  const screenActive = useContext(ScreenActiveContext)
  useEffect(() => {
    if (!ready || !screenActive) return
    const current = getCurrentFocusKey()
    if (
      !current ||
      current === scope ||
      current === ROOT_FOCUS_KEY ||
      !doesFocusableExist(current)
    ) {
      setFocus(target)
    }
  }, [target, ready, scope, screenActive])
}

export function useBackHandler(handler: () => void, active = true): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!active) return
    return backStack.push(() => handlerRef.current())
  }, [active])
}

export function useReturnFocus(): void {
  // Refs survive React StrictMode's simulated unmount/remount: the key is
  // captured once (before the overlay takes the selection) and a restore
  // scheduled by the simulated unmount is cancelled by the remount.
  const previous = useRef<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (previous.current === null) previous.current = getCurrentFocusKey() ?? ''
    return () => {
      // After the overlay's own focusables are gone.
      timer.current = window.setTimeout(() => {
        const key = previous.current
        if (key && doesFocusableExist(key)) setFocus(key)
      }, 0)
    }
  }, [])
}
