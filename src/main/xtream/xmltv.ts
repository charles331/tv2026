/**
 * Streaming XMLTV parser (the provider's `xmltv.php`: ~60 MB, ~170k programmes).
 *
 * Only `<programme>` elements are extracted (channel id, start/stop, title,
 * description). The input is fed in arbitrary text chunks, so the whole file is
 * never held in memory; each complete `<programme>…</programme>` (or
 * self-closing `<programme/>`) is parsed as soon as it is available.
 * XMLTV is regular enough that a small purpose-built scanner beats pulling in a
 * full XML dependency.
 */

export interface XmltvProgramme {
  /** XMLTV channel id — matches a live stream's `epg_channel_id`. */
  channel: string
  startSecs: number
  endSecs: number
  title: string
  description: string | null
}

/** "YYYYMMDDhhmmss ±hhmm" (offset optional → UTC) → epoch seconds. */
export function parseXmltvTime(value: string | null | undefined): number | null {
  const m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(?:([+-])(\d{2})(\d{2}))?/.exec(value ?? '')
  if (!m) return null
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) / 1000
  const offset = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8]! * 3600 + +m[9]! * 60) : 0
  return utc - offset
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decode XML text content: CDATA, named and numeric entities. Trimmed. */
export function decodeXmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  if (cdata) return cdata[1]!.trim()
  return raw
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return NAMED[ent] ?? whole
    })
    .trim()
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)
  return m ? decodeXmlText(m[1] ?? m[2] ?? '') : null
}

/** First `<name …>text</name>` inside a programme body (null if absent/empty). */
function child(body: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(body)
  if (!m) return null
  const text = decodeXmlText(m[1]!)
  return text.length ? text : null
}

export class XmltvProgrammeParser {
  private buf = ''

  constructor(private readonly onProgramme: (p: XmltvProgramme) => void) {}

  /** Feed the next text chunk. */
  push(chunk: string): void {
    this.buf += chunk
    let consumed = 0
    for (;;) {
      const open = this.buf.indexOf('<programme', consumed)
      if (open < 0) {
        // Keep a tail in case "<programme" is split across chunks.
        consumed = Math.max(consumed, this.buf.length - 10)
        break
      }
      const tagEnd = this.buf.indexOf('>', open)
      if (tagEnd < 0) {
        consumed = open
        break
      }
      const openTag = this.buf.slice(open, tagEnd + 1)
      if (openTag.endsWith('/>')) {
        this.emit(openTag, '')
        consumed = tagEnd + 1
        continue
      }
      const close = this.buf.indexOf('</programme>', tagEnd)
      if (close < 0) {
        consumed = open
        break
      }
      this.emit(openTag, this.buf.slice(tagEnd + 1, close))
      consumed = close + '</programme>'.length
    }
    this.buf = this.buf.slice(consumed)
  }

  /** Signal end of input (drops any incomplete trailing element). */
  end(): void {
    this.buf = ''
  }

  private emit(openTag: string, body: string): void {
    // "<programmes>" or similar would not be a programme element.
    if (!/^<programme[\s/>]/.test(openTag)) return
    const channel = attr(openTag, 'channel')
    const startSecs = parseXmltvTime(attr(openTag, 'start'))
    const endSecs = parseXmltvTime(attr(openTag, 'stop'))
    const title = child(body, 'title')
    if (!channel || startSecs == null || endSecs == null || !title) return
    this.onProgramme({ channel, startSecs, endSecs, title, description: child(body, 'desc') })
  }
}
