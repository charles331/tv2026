/**
 * Back-key handler stack: overlays, screens and the app shell each register a
 * handler; the Back key runs only the most recent one still registered (the
 * innermost thing on screen). Removing a handler is idempotent and may happen
 * out of order (React unmount order is not guaranteed).
 */
type Entry = { handler: () => void }

export class BackStack {
  private entries: Entry[] = []

  push(handler: () => void): () => void {
    const entry: Entry = { handler }
    this.entries.push(entry)
    return () => {
      const i = this.entries.indexOf(entry)
      if (i >= 0) this.entries.splice(i, 1)
    }
  }

  /** Runs the latest handler; false when nothing is registered. */
  dispatch(): boolean {
    const top = this.entries[this.entries.length - 1]
    if (!top) return false
    top.handler()
    return true
  }

  size(): number {
    return this.entries.length
  }
}

export const backStack = new BackStack()
