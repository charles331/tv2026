/**
 * Selection hand-back for overlays (pages, dialogs, menus): on open, remember
 * what had the selection; on close, give it back — one tick later, once the
 * overlay's own focusables are gone.
 *
 * An overlay that opens while another one's hand-back is still pending (a
 * second recording conflict replacing the first, React StrictMode's simulated
 * remount) cancels it and inherits its target: the selection is not pulled out
 * of the new overlay, and still returns to the original place at the end.
 */
interface Deps {
  getCurrent: () => string
  exists: (key: string) => boolean
  focus: (key: string) => void
}

export class ReturnFocus {
  private pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(private readonly deps: Deps) {}

  /** Call when the overlay opens; returns the function to call when it closes. */
  open(): () => void {
    let previous: string
    if (this.pending) {
      clearTimeout(this.pending.timer)
      previous = this.pending.key
      this.pending = null
    } else {
      previous = this.deps.getCurrent()
    }
    return () => {
      if (this.pending) clearTimeout(this.pending.timer) // an inner overlay closed with us
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null
        if (previous && this.deps.exists(previous)) this.deps.focus(previous)
      }, 0)
      this.pending = { key: previous, timer }
    }
  }
}
