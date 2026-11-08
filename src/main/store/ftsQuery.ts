/**
 * Build a safe SQLite FTS5 MATCH expression from free text typed by the user:
 * every word becomes a quoted prefix term ("brug"* matches "Brugge") and all
 * must match. Quoting each term neutralises FTS operators (AND/OR/NEAR, -, *,
 * parentheses…), so user input can never change the query structure.
 * Accents/case are handled by the index tokenizer (unicode61 remove_diacritics).
 */
export function toFtsQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8)
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null
}
