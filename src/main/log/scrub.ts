/**
 * PURE secret scrubbing for journal messages — no Electron/Node imports so it
 * is unit-testable. Every message is scrubbed BEFORE being stored or written
 * to disk: the journal must never leak Xtream credentials or signed stream
 * URLs, even when a raw error message embeds one (mpv stderr, undici errors).
 */

/** Mask credentials/secrets that may appear inside a free-form message. */
export function scrubSecrets(text: string): string {
  return (
    text
      // URL userinfo: http://user:pass@host → http://***:***@host
      .replace(/\b(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, '$1***:***@')
      // Xtream stream paths embed credentials: /live/USER/PASS/123.ts (same for
      // /movie/ and /series/).
      .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/***/***/')
      // Credential-ish query params: ?username=..&password=..&token=..
      .replace(/([?&](?:username|password|token|api_key)=)[^&\s]+/gi, '$1***')
  )
}

/** Bound a message for storage (single line, capped length). */
export function boundMessage(text: string, maxLen = 2000): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ⏎ ').trim()
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine
}
