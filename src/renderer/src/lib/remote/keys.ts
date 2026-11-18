/**
 * Remote-control key map: turns a keyboard event into one of the six actions a
 * TV remote offers (arrows, OK, Back). Pure — no DOM listener here; the
 * runtime (RemoteRuntime) owns the listener and decides what each action does.
 *
 * Remotes differ on the Back key: Escape, Backspace, the browser "back" key
 * (key "BrowserBack", keyCode 166) — all are accepted. Inside a text field,
 * Backspace and ←/→ keep their editing meaning.
 */

export type RemoteAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'

/** The parts of a KeyboardEvent the map reads (easy to fake in tests). */
export interface KeyLike {
  key: string
  keyCode?: number
}

const BROWSER_BACK_KEYCODE = 166

const ARROWS: Record<string, RemoteAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

export function keyToAction(e: KeyLike, ctx: { inTextField: boolean }): RemoteAction | null {
  const arrow = ARROWS[e.key]
  if (arrow) {
    // ←/→ move the caret in a text field; ↑/↓ leave it.
    if (ctx.inTextField && (arrow === 'left' || arrow === 'right')) return null
    return arrow
  }
  if (e.key === 'Enter') return 'ok'
  if (e.key === 'Escape' || e.key === 'BrowserBack' || e.keyCode === BROWSER_BACK_KEYCODE) {
    return 'back'
  }
  if (e.key === 'Backspace') return ctx.inTextField ? null : 'back'
  return null
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'password', 'number', 'url', 'email', 'tel'])

/** True for an element where typed keys edit text (Backspace, ←/→ must stay native). */
export function isTextField(el: Element | null): boolean {
  if (!el) return false
  const node = el as Element & { type?: string; isContentEditable?: boolean }
  if (node.isContentEditable) return true
  const tag = node.tagName?.toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((node.type ?? 'text').toLowerCase())
  return false
}

const ALWAYS_EDITING = new Set(['Backspace', 'Delete', 'Home', 'End'])

/**
 * In a text field, does this key stay with the field (edit / move the caret)
 * rather than go to the navigation? ←/→ move the caret, except at the edge of
 * the text, where they leave the field like any other arrow (TV-style: the
 * remote has no other way to reach the button next to a search box).
 */
export function textFieldKeepsKey(
  key: string,
  caret: { selectionStart: number | null; selectionEnd: number | null; valueLength: number }
): boolean {
  if (ALWAYS_EDITING.has(key)) return true
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false
  const { selectionStart: start, selectionEnd: end, valueLength } = caret
  if (start === null || end === null) return false // no caret (e.g. number input)
  if (start !== end) return true // a selection: the arrow collapses it
  return key === 'ArrowLeft' ? start > 0 : start < valueLength
}

/**
 * True when the DOM focus sits on an element the spatial navigation does not
 * manage (focused with the mouse or Tab: a plain button, a slider…). The
 * navigation must then leave Enter and the arrows to that element.
 * Managed elements carry a `data-remote` attribute.
 */
export function isUnmanagedFocus(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName?.toUpperCase()
  if (tag === 'BODY' || tag === 'HTML') return false
  return !el.hasAttribute('data-remote')
}
