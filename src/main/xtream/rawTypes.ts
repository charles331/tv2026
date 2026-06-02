/**
 * Raw Xtream Codes player_api.php response shapes (as the provider sends them).
 *
 * IMPORTANT: this provider is inconsistent with types — numbers are frequently
 * sent as strings ("5", "130", "1780267200"), booleans as 0/1, and some fields
 * may be missing or null. These interfaces describe the *wire* shape; the
 * XtreamClient is responsible for coercing them into the clean, normalized
 * camelCase domain types in `@shared/types/catalog`.
 *
 * Do NOT export these beyond the xtream module — they are an implementation
 * detail of the client. The rest of the app only ever sees the shared types.
 */

/** Tolerant alias: provider sends numbers as strings half the time. */
export type StrNum = string | number | null | undefined

/** `GET /player_api.php?username&password` (no action). */
export interface RawAccountResponse {
  user_info?: RawUserInfo
  server_info?: RawServerInfo
}

export interface RawUserInfo {
  username?: string
  /** 1 = ok, 0 = auth failed. */
  auth?: number
  /** "Active" | "Expired" | "Banned" | "Disabled" | … */
  status?: string
  message?: string
  /** Unix epoch seconds (string) or null for unlimited. */
  exp_date?: string | null
  is_trial?: StrNum
  active_cons?: StrNum
  max_connections?: StrNum
  created_at?: StrNum
  allowed_output_formats?: string[]
}

export interface RawServerInfo {
  url?: string
  port?: string
  https_port?: string
  server_protocol?: string
  timezone?: string
  timestamp_now?: number
  time_now?: string
}

/** One entry from `action=get_vod_categories`. */
export interface RawVodCategory {
  category_id: string
  category_name: string
  parent_id?: StrNum
}

/** One entry from `action=get_vod_streams`. */
export interface RawVodStream {
  num?: number
  name?: string
  stream_type?: string
  stream_id?: number
  stream_icon?: string | null
  rating?: StrNum
  rating_5based?: StrNum
  tmdb?: StrNum
  trailer?: string | null
  added?: StrNum
  is_adult?: StrNum
  category_id?: string | null
  category_ids?: number[]
  container_extension?: string | null
  custom_sid?: string | null
  direct_source?: string | null
}

/** `action=get_vod_info&vod_id=ID` envelope. */
export interface RawVodInfoResponse {
  info?: RawVodInfoDetail
  movie_data?: RawVodMovieData
}

export interface RawVodInfoDetail {
  tmdb_id?: StrNum
  kinopoisk_url?: string
  name?: string
  o_name?: string
  cover_big?: string | null
  movie_image?: string | null
  releasedate?: string | null
  episode_run_time?: StrNum
  youtube_trailer?: string | null
  director?: string | null
  actors?: string | null
  cast?: string | null
  description?: string | null
  plot?: string | null
  age?: string | null
  country?: string | null
  genre?: string | null
  /** May be a single string or an array depending on the item. */
  backdrop_path?: string[] | string | null
  duration_secs?: StrNum
  duration?: string | null
  bitrate?: StrNum
  rating?: StrNum
  runtime?: StrNum
  status?: string | null
  /** Some providers report file size here. */
  movie_size?: StrNum
}

export interface RawVodMovieData {
  stream_id?: number
  name?: string
  added?: StrNum
  category_id?: string | null
  container_extension?: string | null
}

/** One entry from `action=get_series_categories` (same shape as VOD). */
export interface RawSeriesCategory {
  category_id: string
  category_name: string
  parent_id?: StrNum
}

/** One entry from `action=get_series`. */
export interface RawSeries {
  num?: number
  name?: string
  series_id?: StrNum
  cover?: string | null
  plot?: string | null
  cast?: string | null
  director?: string | null
  genre?: string | null
  releaseDate?: string | null
  release_date?: string | null
  last_modified?: StrNum
  rating?: StrNum
  rating_5based?: StrNum
  backdrop_path?: string[] | string | null
  youtube_trailer?: string | null
  tmdb?: StrNum
  category_id?: string | null
  category_ids?: number[]
}

/** `action=get_series_info&series_id=ID` envelope. */
export interface RawSeriesInfoResponse {
  info?: RawSeriesInfoDetail
  seasons?: RawSeason[]
  /** Episodes keyed by season number (as a string), each a list of episodes. */
  episodes?: Record<string, RawEpisode[]>
}

export interface RawSeriesInfoDetail {
  name?: string
  title?: string
  cover?: string | null
  cover_big?: string | null
  plot?: string | null
  cast?: string | null
  director?: string | null
  genre?: string | null
  releaseDate?: string | null
  release_date?: string | null
  rating?: StrNum
  rating_5based?: StrNum
  backdrop_path?: string[] | string | null
  youtube_trailer?: string | null
}

export interface RawSeason {
  season_number?: StrNum
  name?: string | null
  cover?: string | null
  air_date?: string | null
}

export interface RawEpisode {
  /** Episode stream id used in `/series/U/P/{id}.{ext}`. */
  id?: StrNum
  episode_num?: StrNum
  title?: string
  container_extension?: string | null
  season?: StrNum
  info?: RawEpisodeInfo
}

export interface RawEpisodeInfo {
  duration_secs?: StrNum
  duration?: string | null
  plot?: string | null
  rating?: StrNum
  movie_image?: string | null
  cover_big?: string | null
}
