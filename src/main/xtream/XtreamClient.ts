/**
 * XtreamClient — typed HTTP client for the Xtream Codes `player_api.php` API.
 *
 * Provider quirks handled here (see also rawTypes.ts):
 *  - Numbers are often sent as strings ("5", "130") → coerced via toNum/toInt.
 *  - `auth: 0` means bad credentials even with HTTP 200 → mapped to AUTH_FAILED.
 *  - `container_extension` varies per item (mkv/ts/mp4) → always read per stream,
 *    never hardcoded.
 *  - The movie file endpoint `/movie/U/P/{id}.{ext}` answers 302 → a signed
 *    backend URL, then 206 Partial Content. The signed URL is short-lived and
 *    must NOT be cached. buildMovieUrl() returns only the stable, unsigned URL;
 *    callers (download-engineer, mpv) must follow redirects themselves.
 *
 * Single-connection constraint: this client only issues lightweight metadata
 * requests to player_api.php. It NEVER opens the streaming/movie endpoint —
 * that is done by download-engineer / mpv under the ConnectionLock. Metadata
 * calls may be lightly parallelized; we cap concurrency to stay polite.
 *
 * Credentials are passed in by the caller (from secrets/credentials.getCredentials,
 * main-process only). They are NEVER logged: maskUrl() redacts user/pass.
 */

import { request, Agent } from 'undici'
import type { XtreamCredentials } from '@shared/index'
import type { VodCategory, VodInfo, VodStream } from '@shared/index'
import type { Episode, Season, SeriesCategory, SeriesInfo, SeriesStream } from '@shared/index'
import type {
  RawAccountResponse,
  RawEpisode,
  RawSeries,
  RawSeriesCategory,
  RawSeriesInfoResponse,
  RawVodCategory,
  RawVodInfoResponse,
  RawVodStream,
  StrNum
} from './rawTypes'
import { XtreamError } from './errors'

/** Realistic desktop User-Agent — some panels reject default/unknown clients. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tv2026/0.1 Safari/537.36'

/** Timeouts (ms). Metadata is small JSON, but get_vod_streams can be a few MB. */
const HEADERS_TIMEOUT_MS = 15_000
const BODY_TIMEOUT_MS = 60_000

/** Normalized account info returned by getAccountInfo(). */
export interface AccountInfo {
  username: string | null
  /** 1 = ok. */
  auth: number
  status: 'active' | 'expired' | 'banned' | 'disabled' | 'unknown'
  /** Unix epoch seconds, or null if unlimited/unknown. */
  expiresAt: number | null
  maxConnections: number | null
  activeConnections: number | null
  isTrial: boolean | null
  server: {
    url: string | null
    timezone: string | null
    timestampNow: number | null
  }
}

// ---------- coercion helpers (provider sends numbers as strings) ----------

function toNum(v: StrNum): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function toInt(v: StrNum): number | null {
  const n = toNum(v)
  return n === null ? null : Math.trunc(n)
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t.length ? t : null
}

/** Parse the provider's textual `status` into our discriminant. */
function parseStatus(status: string | undefined): AccountInfo['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return 'active'
    case 'expired':
      return 'expired'
    case 'banned':
      return 'banned'
    case 'disabled':
      return 'disabled'
    default:
      return 'unknown'
  }
}

/** Redact username/password from a URL for safe logging. */
export function maskUrl(url: string): string {
  return url
    .replace(/([?&]username=)[^&]*/i, '$1***')
    .replace(/([?&]password=)[^&]*/i, '$1***')
    .replace(/\/movie\/[^/]+\/[^/]+\//i, '/movie/***/***/')
}

/** Build the player_api.php query string. action omitted → account info. */
function buildApiUrl(
  baseUrl: string,
  creds: XtreamCredentials,
  params: Record<string, string> = {}
): string {
  const u = new URL(`${baseUrl}/player_api.php`)
  u.searchParams.set('username', creds.username)
  u.searchParams.set('password', creds.password)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

export class XtreamClient {
  private readonly creds: XtreamCredentials
  private readonly baseUrl: string
  private readonly agent: Agent

  constructor(creds: XtreamCredentials) {
    if (!creds || !creds.baseUrl || !creds.username || !creds.password) {
      throw new XtreamError('NO_CREDENTIALS', 'Missing Xtream credentials.')
    }
    this.creds = creds
    this.baseUrl = creds.baseUrl.replace(/\/+$/, '')
    // One pooled agent; keeps connections to the metadata endpoint cheap.
    this.agent = new Agent({
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
      connect: { timeout: HEADERS_TIMEOUT_MS }
    })
  }

  /** Release pooled sockets (call on shutdown / credential change). */
  async close(): Promise<void> {
    await this.agent.close().catch(() => undefined)
  }

  /**
   * Low-level GET to player_api.php returning parsed JSON.
   * Throws typed XtreamError on network / HTTP / parse failure.
   */
  private async apiGet<T>(params: Record<string, string>): Promise<T> {
    const url = buildApiUrl(this.baseUrl, this.creds, params)
    let res
    try {
      // player_api.php returns JSON 200 directly (no redirects), so we don't
      // need redirect following here. The movie endpoint (302) is handled by
      // download-engineer / mpv, not by this metadata client.
      res = await request(url, {
        method: 'GET',
        dispatcher: this.agent,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
      })
    } catch (e) {
      throw new XtreamError(
        'NETWORK_ERROR',
        'Could not reach the IPTV provider. Check your connection and base URL.',
        `${(e as Error)?.name}: ${(e as Error)?.message} @ ${maskUrl(url)}`
      )
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      // Drain body to free the socket.
      await res.body.dump().catch(() => undefined)
      // Provider quirk: THIS panel answers HTTP 512 (empty body) for invalid
      // credentials, alongside the usual 401/403. Treat all three as auth
      // failures so the renderer shows "check your username/password".
      const isAuth =
        res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 512
      throw new XtreamError(
        isAuth ? 'AUTH_FAILED' : 'NETWORK_ERROR',
        isAuth
          ? 'Authentication failed (invalid username or password).'
          : `Provider returned HTTP ${res.statusCode}.`,
        `${maskUrl(url)} -> ${res.statusCode}`
      )
    }

    const text = await res.body.text()
    // Xtream returns empty body / "false" / HTML on some error states.
    const trimmed = text.trim()
    if (!trimmed || trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'null') {
      throw new XtreamError('MALFORMED', 'Provider returned an empty response.')
    }
    try {
      return JSON.parse(trimmed) as T
    } catch {
      throw new XtreamError(
        'MALFORMED',
        'Provider returned a malformed (non-JSON) response.',
        `body starts with: ${trimmed.slice(0, 80)}`
      )
    }
  }

  /** Account + server info. Maps `auth:0` / non-active status to AUTH_FAILED. */
  async getAccountInfo(): Promise<AccountInfo> {
    const raw = await this.apiGet<RawAccountResponse>({})
    const ui = raw.user_info
    if (!ui || typeof ui !== 'object') {
      throw new XtreamError('MALFORMED', 'Account response missing user_info.')
    }
    if (ui.auth === 0) {
      throw new XtreamError('AUTH_FAILED', 'Authentication failed (invalid username or password).')
    }
    const status = parseStatus(ui.status)
    const si = raw.server_info ?? {}
    return {
      username: nonEmpty(ui.username) ?? null,
      auth: ui.auth ?? 0,
      status,
      expiresAt: toInt(ui.exp_date ?? null),
      maxConnections: toInt(ui.max_connections),
      activeConnections: toInt(ui.active_cons),
      isTrial: ui.is_trial === undefined ? null : toInt(ui.is_trial) === 1,
      server: {
        url: nonEmpty(si.url) ?? null,
        timezone: nonEmpty(si.timezone) ?? null,
        timestampNow: toInt(si.timestamp_now)
      }
    }
  }

  /** Fetch all VOD categories. */
  async getVodCategories(): Promise<VodCategory[]> {
    const raw = await this.apiGet<RawVodCategory[]>({ action: 'get_vod_categories' })
    if (!Array.isArray(raw)) {
      throw new XtreamError('MALFORMED', 'get_vod_categories did not return an array.')
    }
    return raw.map((c) => this.mapCategory(c))
  }

  /**
   * Fetch VOD streams, optionally filtered by category.
   * Without a category this returns the entire catalogue (~26k items) in one
   * response — the caller (catalog:refresh) should batch-upsert it into SQLite,
   * never hand it whole to the renderer.
   */
  async getVodStreams(categoryId?: string): Promise<VodStream[]> {
    const params: Record<string, string> = { action: 'get_vod_streams' }
    if (categoryId) params.category_id = categoryId
    const raw = await this.apiGet<RawVodStream[]>(params)
    if (!Array.isArray(raw)) {
      throw new XtreamError('MALFORMED', 'get_vod_streams did not return an array.')
    }
    const out: VodStream[] = []
    for (const s of raw) {
      const mapped = this.mapStream(s, categoryId)
      if (mapped) out.push(mapped)
    }
    return out
  }

  /** Fetch full detail for one movie. Throws NOT_FOUND if the id is unknown. */
  async getVodInfo(vodId: number): Promise<VodInfo> {
    const raw = await this.apiGet<RawVodInfoResponse>({
      action: 'get_vod_info',
      vod_id: String(vodId)
    })
    const info = raw.info
    const movie = raw.movie_data
    // Provider returns {info:[], movie_data:null} or {} for unknown ids.
    if (!info || Array.isArray(info) || !movie) {
      throw new XtreamError('NOT_FOUND', `No movie detail found for id ${vodId}.`)
    }
    return this.mapInfo(vodId, raw)
  }

  // ---------------- series ----------------

  /** Fetch all series categories. */
  async getSeriesCategories(): Promise<SeriesCategory[]> {
    const raw = await this.apiGet<RawSeriesCategory[]>({ action: 'get_series_categories' })
    if (!Array.isArray(raw)) {
      throw new XtreamError('MALFORMED', 'get_series_categories did not return an array.')
    }
    return raw.map((c) => ({
      categoryId: String(c.category_id),
      categoryName: c.category_name ?? '',
      parentId: toInt(c.parent_id) ?? 0
    }))
  }

  /** Fetch series, optionally filtered by category. */
  async getSeries(categoryId?: string): Promise<SeriesStream[]> {
    const params: Record<string, string> = { action: 'get_series' }
    if (categoryId) params.category_id = categoryId
    const raw = await this.apiGet<RawSeries[]>(params)
    if (!Array.isArray(raw)) {
      throw new XtreamError('MALFORMED', 'get_series did not return an array.')
    }
    const out: SeriesStream[] = []
    for (const s of raw) {
      const mapped = this.mapSeries(s, categoryId)
      if (mapped) out.push(mapped)
    }
    return out
  }

  /** Fetch full detail (seasons + episodes) for one series. NOT_FOUND if unknown. */
  async getSeriesInfo(seriesId: number): Promise<SeriesInfo> {
    const raw = await this.apiGet<RawSeriesInfoResponse>({
      action: 'get_series_info',
      series_id: String(seriesId)
    })
    if (!raw || typeof raw !== 'object' || !raw.episodes || Array.isArray(raw.info)) {
      throw new XtreamError('NOT_FOUND', `No series detail found for id ${seriesId}.`)
    }
    return this.mapSeriesInfo(seriesId, raw)
  }

  /**
   * Build the stable episode file URL: `/series/USER/PASS/{episodeId}.{ext}`.
   * Same redirect/Range/ConnectionLock rules as buildMovieUrl. `episodeId` is the
   * per-episode id (NOT the series id); `ext` is the episode containerExtension.
   */
  buildEpisodeUrl(episodeId: number, ext: string): string {
    const cleanExt = ext.replace(/^\.+/, '').trim() || 'mkv'
    return `${this.baseUrl}/series/${encodeURIComponent(this.creds.username)}/${encodeURIComponent(
      this.creds.password
    )}/${episodeId}.${cleanExt}`
  }

  /**
   * Build the stable movie file URL: `/movie/USER/PASS/{streamId}.{ext}`.
   *
   * This is the canonical entry point for download-engineer and mpv. The server
   * answers 302 → a signed backend URL, then 206 Partial Content. Callers MUST:
   *  - follow redirects,
   *  - NOT cache the resolved/signed URL,
   *  - acquire the ConnectionLock before opening it (single-connection limit),
   *  - use Range requests for resume.
   * `ext` MUST come from the stream's `containerExtension` (varies per item).
   */
  buildMovieUrl(streamId: number, ext: string): string {
    const cleanExt = ext.replace(/^\.+/, '').trim() || 'mkv'
    return `${this.baseUrl}/movie/${encodeURIComponent(this.creds.username)}/${encodeURIComponent(
      this.creds.password
    )}/${streamId}.${cleanExt}`
  }

  // ---------------- mappers (raw → shared domain types) ----------------

  private mapCategory(c: RawVodCategory): VodCategory {
    return {
      categoryId: String(c.category_id),
      categoryName: c.category_name ?? '',
      parentId: toInt(c.parent_id) ?? 0
    }
  }

  /** Returns null for entries without a usable stream_id. */
  private mapStream(s: RawVodStream, fallbackCategoryId?: string): VodStream | null {
    const streamId = toInt(s.stream_id)
    if (streamId === null) return null
    return {
      streamId,
      name: s.name ?? '',
      streamIcon: nonEmpty(s.stream_icon ?? null),
      rating: toNum(s.rating),
      containerExtension: nonEmpty(s.container_extension ?? null) ?? 'mkv',
      categoryId: nonEmpty(s.category_id ?? null) ?? fallbackCategoryId ?? '',
      year: this.extractYear(s.name, null),
      addedAt: toInt(s.added)
    }
  }

  private mapInfo(streamId: number, raw: RawVodInfoResponse): VodInfo {
    const info = raw.info ?? {}
    const movie = raw.movie_data ?? {}
    const backdrops = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.filter((b): b is string => typeof b === 'string' && b.length > 0)
      : typeof info.backdrop_path === 'string' && info.backdrop_path
        ? [info.backdrop_path]
        : []
    const name = nonEmpty(movie.name) ?? nonEmpty(info.name) ?? ''
    const year = this.extractYear(name, info.releasedate ?? null)
    // duration_secs is sometimes "minutes" mislabeled by panels, but this
    // provider reports true seconds; keep as-is.
    const durationSecs = toInt(info.duration_secs)
    const trailer = nonEmpty(info.youtube_trailer)
    return {
      streamId,
      name,
      title: nonEmpty(info.o_name) ?? nonEmpty(info.name),
      year,
      plot: nonEmpty(info.plot) ?? nonEmpty(info.description),
      cast: nonEmpty(info.cast) ?? nonEmpty(info.actors),
      director: nonEmpty(info.director),
      genre: nonEmpty(info.genre),
      durationSecs,
      rating: toNum(info.rating),
      posterUrl: nonEmpty(info.movie_image) ?? nonEmpty(info.cover_big),
      backdropUrls: backdrops,
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer}` : null,
      containerExtension: nonEmpty(movie.container_extension ?? null) ?? 'mkv',
      sizeBytes: toInt(info.movie_size),
      bitrate: toInt(info.bitrate),
      // TMDB id comes from the provider; the live rating is filled in later by
      // catalogService when a TMDB API key is configured.
      tmdbId: toInt(info.tmdb_id),
      tmdbRating: null,
      tmdbVoteCount: null
    }
  }

  /** Best-effort year extraction from a title like "Foo (2021)" or a date. */
  private extractYear(name: string | undefined, releaseDate: string | null): number | null {
    if (releaseDate) {
      const m = /^(\d{4})/.exec(releaseDate.trim())
      if (m) {
        const y = Number(m[1])
        if (y >= 1880 && y <= 2100) return y
      }
    }
    if (name) {
      const m = /\b(19|20)\d{2}\b/.exec(name)
      if (m) {
        const y = Number(m[0])
        if (y >= 1880 && y <= 2100) return y
      }
    }
    return null
  }

  // ---------------- series mappers ----------------

  /** Returns null for entries without a usable series_id. */
  private mapSeries(s: RawSeries, fallbackCategoryId?: string): SeriesStream | null {
    const seriesId = toInt(s.series_id)
    if (seriesId === null) return null
    const name = s.name ?? ''
    return {
      seriesId,
      name,
      cover: nonEmpty(s.cover ?? null),
      rating: toNum(s.rating),
      categoryId: nonEmpty(s.category_id ?? null) ?? fallbackCategoryId ?? '',
      year: this.extractYear(name, s.releaseDate ?? s.release_date ?? null),
      lastModified: toInt(s.last_modified),
      plot: nonEmpty(s.plot ?? null),
      genre: nonEmpty(s.genre ?? null)
    }
  }

  private mapSeriesInfo(seriesId: number, raw: RawSeriesInfoResponse): SeriesInfo {
    const info = raw.info ?? {}
    const backdrops = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.filter((b): b is string => typeof b === 'string' && b.length > 0)
      : typeof info.backdrop_path === 'string' && info.backdrop_path
        ? [info.backdrop_path]
        : []
    const name = nonEmpty(info.name) ?? nonEmpty(info.title) ?? ''
    const trailer = nonEmpty(info.youtube_trailer)

    // `episodes` is an object keyed by season number ("1", "2", …). Flatten into
    // ordered seasons, each with ordered episodes.
    const bySeason = new Map<number, Episode[]>()
    for (const [seasonKey, list] of Object.entries(raw.episodes ?? {})) {
      if (!Array.isArray(list)) continue
      const seasonFromKey = Number(seasonKey)
      for (const ep of list) {
        const mapped = this.mapEpisode(ep, Number.isFinite(seasonFromKey) ? seasonFromKey : 0)
        if (!mapped) continue
        const arr = bySeason.get(mapped.season) ?? []
        arr.push(mapped)
        bySeason.set(mapped.season, arr)
      }
    }
    const seasons: Season[] = [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, episodes]) => ({
        seasonNumber,
        name: null,
        episodes: episodes.sort((a, b) => a.episodeNum - b.episodeNum)
      }))

    return {
      seriesId,
      name,
      plot: nonEmpty(info.plot),
      cast: nonEmpty(info.cast),
      director: nonEmpty(info.director),
      genre: nonEmpty(info.genre),
      year: this.extractYear(name, info.releaseDate ?? info.release_date ?? null),
      rating: toNum(info.rating),
      cover: nonEmpty(info.cover_big) ?? nonEmpty(info.cover),
      backdropUrls: backdrops,
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer}` : null,
      seasons
    }
  }

  /** Returns null for episodes without a usable id. */
  private mapEpisode(ep: RawEpisode, seasonFromKey: number): Episode | null {
    const episodeId = toInt(ep.id)
    if (episodeId === null) return null
    const epInfo = ep.info ?? {}
    return {
      episodeId,
      title: nonEmpty(ep.title) ?? `Épisode ${toInt(ep.episode_num) ?? episodeId}`,
      season: toInt(ep.season) ?? seasonFromKey,
      episodeNum: toInt(ep.episode_num) ?? 0,
      containerExtension: nonEmpty(ep.container_extension ?? null) ?? 'mkv',
      durationSecs: toInt(epInfo.duration_secs),
      plot: nonEmpty(epInfo.plot ?? null),
      rating: toNum(epInfo.rating),
      image: nonEmpty(epInfo.movie_image ?? null) ?? nonEmpty(epInfo.cover_big ?? null)
    }
  }
}
