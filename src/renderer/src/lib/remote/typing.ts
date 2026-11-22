/**
 * "Type to search": a letter or digit typed while no text field is selected
 * (e.g. on the keyboard at the back of the remote) starts a global search with
 * it. Pure — RemoteRuntime calls it from its key listener.
 */
const SEARCH_CHAR = /^[\p{L}\p{N}]$/u

export function typedSearchChar(
  e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  ctx: { inTextField: boolean }
): string | null {
  if (ctx.inTextField || e.ctrlKey || e.altKey || e.metaKey) return null
  return SEARCH_CHAR.test(e.key) ? e.key : null
}
