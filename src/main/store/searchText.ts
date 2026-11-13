/**
 * Tolerant title search: accents, case, ligatures and punctuation are ignored,
 * and the words of the query may appear in any order ("matrix reloaded" finds
 * "The Matrix Reloaded", "elephant" finds "Éléphant").
 *
 * Titles are normalised on the fly by the `search_norm` SQL function (registered
 * on the connection in db.ts), so nothing is stored and no migration is needed.
 * A title search is a full scan either way (`LIKE '%x%'` cannot use an index);
 * measured at ~50-90 ms on 28k movies.
 */

/** Lowercase, strip accents, expand ligatures, punctuation → single spaces. */
export function normalizeForSearch(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Name of the SQL function wrapping {@link normalizeForSearch}. */
export const SEARCH_NORM_FN = 'search_norm'

const MAX_WORDS = 8

/**
 * WHERE fragment matching `column` against every word of `query` (AND), or
 * null when the query holds nothing searchable. Words only contain letters and
 * digits after normalisation, so they can never act as LIKE wildcards.
 */
export function nameSearch(
  column: string,
  query: string
): { clause: string; params: string[] } | null {
  const words = normalizeForSearch(query).split(' ').filter(Boolean).slice(0, MAX_WORDS)
  if (words.length === 0) return null
  return {
    clause: words.map(() => `${SEARCH_NORM_FN}(${column}) LIKE ?`).join(' AND '),
    params: words.map((w) => `%${w}%`)
  }
}
