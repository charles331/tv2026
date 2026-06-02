/**
 * SQLite schema + migrations. SOURCE OF TRUTH for the local store.
 *
 * Migrations are an ordered array; `user_version` PRAGMA tracks the applied
 * version. Add new migrations by appending — never edit an applied one.
 *
 * Tables:
 *  - settings          key/value app settings (non-secret only)
 *  - vod_categories    cached VOD categories
 *  - vod_streams       cached movie list rows (lightweight, ~26k rows)
 *  - vod_info_cache    cached get_vod_info detail blobs (JSON) per stream
 *  - download_queue    active/pending/paused/failed downloads (persistent)
 *  - download_history  completed/canceled downloads (audit + "downloaded?" flag)
 *
 * NOTE: Xtream credentials are NEVER stored here — they live encrypted via
 * Electron safeStorage (see src/main/secrets).
 */

export interface Migration {
  version: number
  description: string
  /** SQL executed in a single transaction. */
  up: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vod_categories (
        category_id   TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        parent_id     INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vod_streams (
        stream_id            INTEGER PRIMARY KEY,
        name                 TEXT NOT NULL,
        stream_icon          TEXT,
        rating               REAL,
        container_extension  TEXT NOT NULL DEFAULT 'mkv',
        category_id          TEXT,
        year                 INTEGER,
        added_at             INTEGER,
        updated_at           INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES vod_categories(category_id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vod_streams_category ON vod_streams(category_id);
      CREATE INDEX IF NOT EXISTS idx_vod_streams_name     ON vod_streams(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_vod_streams_added     ON vod_streams(added_at);

      CREATE TABLE IF NOT EXISTS vod_info_cache (
        stream_id  INTEGER PRIMARY KEY,
        info_json  TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        FOREIGN KEY (stream_id) REFERENCES vod_streams(stream_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS download_queue (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id            INTEGER NOT NULL,
        name                 TEXT NOT NULL,
        file_name            TEXT NOT NULL,
        dest_path            TEXT NOT NULL,
        container_extension  TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'queued',
        total_bytes          INTEGER,
        received_bytes       INTEGER NOT NULL DEFAULT 0,
        queue_position       INTEGER NOT NULL DEFAULT 0,
        error                TEXT,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dlq_status   ON download_queue(status);
      CREATE INDEX IF NOT EXISTS idx_dlq_position ON download_queue(queue_position);

      CREATE TABLE IF NOT EXISTS download_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id    INTEGER NOT NULL,
        name         TEXT NOT NULL,
        file_name    TEXT NOT NULL,
        dest_path    TEXT NOT NULL,
        total_bytes  INTEGER,
        status       TEXT NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dlh_stream ON download_history(stream_id);
    `
  },
  {
    version: 2,
    description: 'series cache + download kind (movie/series episode)',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS series_categories (
        category_id   TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        parent_id     INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS series (
        series_id     INTEGER PRIMARY KEY,
        name          TEXT NOT NULL,
        cover         TEXT,
        rating        REAL,
        category_id   TEXT,
        year          INTEGER,
        last_modified INTEGER,
        plot          TEXT,
        genre         TEXT,
        updated_at    INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES series_categories(category_id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);
      CREATE INDEX IF NOT EXISTS idx_series_name     ON series(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_series_modified  ON series(last_modified);

      CREATE TABLE IF NOT EXISTS series_info_cache (
        series_id  INTEGER PRIMARY KEY,
        info_json  TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        FOREIGN KEY (series_id) REFERENCES series(series_id) ON DELETE CASCADE
      );

      -- Distinguish movie downloads from series episodes (different stream URL).
      ALTER TABLE download_queue   ADD COLUMN kind TEXT NOT NULL DEFAULT 'movie';
      ALTER TABLE download_history ADD COLUMN kind TEXT NOT NULL DEFAULT 'movie';
    `
  },
  {
    version: 3,
    description: 'live TV cache (channels + categories)',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS live_categories (
        category_id   TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        parent_id     INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_streams (
        stream_id      INTEGER PRIMARY KEY,
        name           TEXT NOT NULL,
        icon           TEXT,
        number         INTEGER,
        epg_channel_id TEXT,
        category_id    TEXT,
        has_archive    INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES live_categories(category_id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_live_category ON live_streams(category_id);
      CREATE INDEX IF NOT EXISTS idx_live_name     ON live_streams(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_live_number    ON live_streams(number);
    `
  }
]

/** The schema version the running code expects (latest migration version). */
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
