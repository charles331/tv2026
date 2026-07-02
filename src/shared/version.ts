/** Dotted-numeric version comparison, shared by main (updater) and renderer. */

/** True if `a` is strictly newer than `b` (e.g. "0.10.1" > "0.9.3"). */
export function isVersionNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db
  }
  return false
}
