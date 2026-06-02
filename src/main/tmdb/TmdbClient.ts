/**
 * Minimal TMDB (The Movie Database) client — fetches the LIVE movie rating by
 * TMDB id, so the UI can show an up-to-date community score instead of the
 * provider's stale/placeholder `rating`.
 *
 * Uses the TMDB API v3 with the user's own API key (stored encrypted via
 * secrets/tmdbKey). Only read-only public data is requested. All failures are
 * swallowed (return null):
 * the rating is a nice-to-have, never a hard dependency.
 *
 * Docs: https://developer.themoviedb.org/reference/movie-details
 */

import { request, Agent } from 'undici'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const USER_AGENT = 'tv2026/0.1 (+https://github.com/charles331/tv2026)'
const HEADERS_TIMEOUT_MS = 10_000
const BODY_TIMEOUT_MS = 15_000

export interface TmdbMovie {
  /** Community score on a 0–10 scale, or null when there are no usable votes. */
  rating: number | null
  /** Number of votes backing the score, or null. */
  voteCount: number | null
  /** IMDb id (e.g. "tt26749549"), or null when TMDB doesn't expose one. */
  imdbId: string | null
}

/** Build the movie-details endpoint URL. Exposed for testing. */
export function buildTmdbMovieUrl(tmdbId: number, apiKey: string): string {
  const u = new URL(`${TMDB_BASE}/movie/${tmdbId}`)
  u.searchParams.set('api_key', apiKey)
  return u.toString()
}

/**
 * Parse a TMDB `/movie/{id}` payload into a normalized rating + IMDb id. Returns
 * null only when the payload is not an object; `rating`/`voteCount`/`imdbId` are
 * individually null when absent. Pure / unit-testable: no network.
 */
export function parseTmdbMovie(raw: unknown): TmdbMovie | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const avg = typeof obj.vote_average === 'number' ? obj.vote_average : Number(obj.vote_average)
  const votes = typeof obj.vote_count === 'number' ? obj.vote_count : Number(obj.vote_count)
  const hasVotes = Number.isFinite(avg) && avg > 0 && Number.isFinite(votes) && votes > 0
  const imdbId =
    typeof obj.imdb_id === 'string' && /^tt\d+$/.test(obj.imdb_id) ? obj.imdb_id : null
  return {
    rating: hasVotes ? Math.max(0, Math.min(10, avg)) : null,
    voteCount: hasVotes ? Math.trunc(votes) : null,
    imdbId
  }
}

/** Redact the api_key from a URL for safe logging. */
function maskKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/i, '$1***')
}

/**
 * Fetch the live TMDB rating + IMDb id for a movie id. Best-effort: returns null
 * on any error (bad key, 404, network, malformed body). Never throws.
 */
export async function fetchTmdbMovie(apiKey: string, tmdbId: number): Promise<TmdbMovie | null> {
  if (!apiKey || !Number.isFinite(tmdbId) || tmdbId <= 0) return null
  const url = buildTmdbMovieUrl(tmdbId, apiKey)
  const agent = new Agent({
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
    connect: { timeout: HEADERS_TIMEOUT_MS }
  })
  try {
    const res = await request(url, {
      method: 'GET',
      dispatcher: agent,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => undefined)
      console.warn(`[tmdb] ${maskKey(url)} -> ${res.statusCode}`)
      return null
    }
    const text = await res.body.text()
    return parseTmdbMovie(JSON.parse(text))
  } catch (e) {
    console.warn(`[tmdb] fetch failed for id ${tmdbId}: ${(e as Error)?.message}`)
    return null
  } finally {
    await agent.close().catch(() => undefined)
  }
}
