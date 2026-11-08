import { describe, it, expect } from 'vitest'
import {
  XmltvProgrammeParser,
  parseXmltvTime,
  decodeXmlText,
  type XmltvProgramme
} from '../../src/main/xtream/xmltv'

describe('parseXmltvTime', () => {
  it('parses "YYYYMMDDhhmmss ±hhmm" to epoch seconds', () => {
    expect(parseXmltvTime('20261108130000 +0000')).toBe(Date.UTC(2026, 10, 8, 13, 0, 0) / 1000)
    expect(parseXmltvTime('20261108140000 +0100')).toBe(Date.UTC(2026, 10, 8, 13, 0, 0) / 1000)
    expect(parseXmltvTime('20261108080000 -0500')).toBe(Date.UTC(2026, 10, 8, 13, 0, 0) / 1000)
  })
  it('treats a missing offset as UTC and rejects garbage', () => {
    expect(parseXmltvTime('20261108130000')).toBe(Date.UTC(2026, 10, 8, 13, 0, 0) / 1000)
    expect(parseXmltvTime('')).toBeNull()
    expect(parseXmltvTime('demain')).toBeNull()
  })
})

describe('decodeXmlText', () => {
  it('decodes entities and CDATA', () => {
    expect(decodeXmlText('Club Brugge &amp; RSC Anderlecht &lt;LIVE&gt; &quot;J10&quot; &#233;t&#xE9;')).toBe(
      'Club Brugge & RSC Anderlecht <LIVE> "J10" été'
    )
    expect(decodeXmlText('<![CDATA[A & B]]>')).toBe('A & B')
  })
})

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="panel">
  <channel id="dazn1.be"><display-name>DAZN 1</display-name></channel>
  <programme start="20261108130000 +0000" stop="20261108150000 +0000" channel="dazn1.be">
    <title lang="fr">LIVE: Club Brugge - RSC Anderlecht</title>
    <desc lang="fr">Pro League, journée 14 &amp; choc au sommet.</desc>
  </programme>
  <programme start="20261108150000 +0000" stop="20261108160000 +0000" channel="dazn1.be">
    <title>Studio d&#233;brief</title>
  </programme>
  <programme channel="tf1.fr" stop="20261108210000 +0100" start="20261108200000 +0100"><title>Journal</title><desc/></programme>
</tv>`

function parseAll(text: string, chunkSize: number): XmltvProgramme[] {
  const out: XmltvProgramme[] = []
  const p = new XmltvProgrammeParser((prog) => out.push(prog))
  for (let i = 0; i < text.length; i += chunkSize) p.push(text.slice(i, i + chunkSize))
  p.end()
  return out
}

describe('XmltvProgrammeParser', () => {
  it('extracts programmes with channel, times, title and description', () => {
    const out = parseAll(SAMPLE, SAMPLE.length)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({
      channel: 'dazn1.be',
      startSecs: Date.UTC(2026, 10, 8, 13) / 1000,
      endSecs: Date.UTC(2026, 10, 8, 15) / 1000,
      title: 'LIVE: Club Brugge - RSC Anderlecht',
      description: 'Pro League, journée 14 & choc au sommet.'
    })
    expect(out[1]).toMatchObject({ title: 'Studio débrief', description: null })
    // attribute order doesn't matter; empty <desc/> → null
    expect(out[2]).toMatchObject({ channel: 'tf1.fr', title: 'Journal', description: null })
  })

  it('gives the same result whatever the chunk boundaries (streaming)', () => {
    const whole = parseAll(SAMPLE, SAMPLE.length)
    for (const size of [1, 7, 64, 333]) expect(parseAll(SAMPLE, size)).toEqual(whole)
  })

  it('skips programmes without a usable channel, time or title', () => {
    const bad = `<tv><programme start="x" stop="20261108150000 +0000" channel="a"><title>T</title></programme>
      <programme start="20261108130000 +0000" stop="20261108150000 +0000"><title>T</title></programme>
      <programme start="20261108130000 +0000" stop="20261108150000 +0000" channel="a"></programme></tv>`
    expect(parseAll(bad, 50)).toEqual([])
  })
})
