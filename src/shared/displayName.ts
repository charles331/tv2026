/**
 * Name as shown on screen. The provider prefixes nearly every French title
 * with its language ("FR - Dune", "|FR| TF1 UHD", "[FR] Cheval TV", "FR | M6"): on a TV that
 * tag eats most of a card's width for no information, so it is hidden.
 * Other language tags (|US|, |BE|, AF -…) stay: they tell what is NOT French.
 * Display only: search, sort, file names and stored data keep the raw name.
 */
const FR_PREFIX = /^\s*[|[]?\s*FR\.?\s*[-|:\]]\s*/i

export function displayName(name: string): string {
  const stripped = name.replace(FR_PREFIX, '')
  return stripped.trim() === '' ? name : stripped
}
