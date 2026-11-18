/**
 * Remote-control runtime: starts the spatial navigation (Norigin) and owns the
 * one capture-phase keydown listener that sits in front of it.
 *
 * - Back (Escape, Backspace outside a text field, BrowserBack, mouse "back"
 *   button) never reaches Norigin: it runs the latest handler of the back stack.
 * - In a text field, the editing keys (←/→ inside the text, Backspace,
 *   Home/End) are stopped before Norigin sees them, so the caret moves and
 *   characters get deleted; ←/→ at the edge of the text leave the field.
 * - Everything else (arrows, Enter) goes on to Norigin's own window listener,
 *   unless the DOM focus is on an element Norigin does not manage (a plain
 *   button or slider focused with the mouse / Tab): Norigin would otherwise
 *   swallow the key and act on its own selection instead.
 *
 * It also tracks the input modality on <html data-input="keys|pointer">: the
 * selection ring is only drawn after a navigation key, never while the mouse
 * is being used.
 */
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { keyToAction, isTextField, textFieldKeepsKey, isUnmanagedFocus } from './keys'
import { backStack } from './backStack'
import { zoneKeys } from './focus'
import { typedSearchChar } from './typing'

const POINTER_MOVE_THRESHOLD = 2 // px; an idle mouse sends tiny moves

let started = false
let typeToSearch: ((char: string) => void) | null = null

/** What typing a letter outside a text field does (null = nothing). */
export function setTypeToSearchHandler(fn: ((char: string) => void) | null): void {
  typeToSearch = fn
}

function setModality(mode: 'keys' | 'pointer'): void {
  const root = document.documentElement
  if (root.dataset.input !== mode) root.dataset.input = mode
}

export function startRemote(): void {
  if (started) return
  started = true
  // Registered BEFORE init(): window bubble listeners run in order, so this one
  // runs after React's handlers but ahead of Norigin's.
  window.addEventListener('keydown', (e) => {
    if (isUnmanagedFocus(document.activeElement)) e.stopImmediatePropagation()
  })
  init({ shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true }, throttle: 0 })
  setModality('pointer')

  window.addEventListener(
    'keydown',
    (e) => {
      const inTextField = isTextField(document.activeElement)
      const action = keyToAction(e, { inTextField })
      if (action === 'back') {
        e.preventDefault()
        e.stopPropagation()
        setModality('keys')
        backStack.dispatch()
        return
      }
      const typed = typeToSearch ? typedSearchChar(e, { inTextField }) : null
      if (typed && typeToSearch) {
        e.preventDefault() // the search box gets the letter from the handler
        typeToSearch(typed)
        return
      }
      if (inTextField) {
        const field = document.activeElement as HTMLInputElement
        let caret: { selectionStart: number | null; selectionEnd: number | null }
        try {
          caret = { selectionStart: field.selectionStart, selectionEnd: field.selectionEnd }
        } catch {
          caret = { selectionStart: null, selectionEnd: null } // input types without a caret
        }
        if (textFieldKeepsKey(e.key, { ...caret, valueLength: field.value?.length ?? 0 })) {
          e.stopPropagation() // native caret / deletion, no navigation
          return
        }
      }
      if (action) setModality('keys')
      // The selection may sit on a zone itself: it was given the selection
      // while still empty (a list loading). Its children are there now: the
      // first key enters the zone instead of navigating away from it.
      const current = getCurrentFocusKey()
      if (
        action &&
        zoneKeys.has(current) &&
        document.querySelector(`[data-focus-zone="${current}"] [data-remote]`)
      ) {
        e.preventDefault()
        e.stopPropagation()
        void setFocus(current)
      }
    },
    { capture: true }
  )

  let last: { x: number; y: number } | null = null
  window.addEventListener('mousemove', (e) => {
    if (
      last &&
      (Math.abs(e.clientX - last.x) > POINTER_MOVE_THRESHOLD ||
        Math.abs(e.clientY - last.y) > POINTER_MOVE_THRESHOLD)
    ) {
      setModality('pointer')
    }
    last = { x: e.clientX, y: e.clientY }
  })
  window.addEventListener('mousedown', () => setModality('pointer'))
  // Mouse "back" button (and remotes that send it).
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault()
      backStack.dispatch()
    }
  })
}
