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
 *  - vod_file_check    real movie file size from a 1-byte request (quality check)
 *  - epg_programmes    full programme guide (xmltv.php) + epg_fts full-text index
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
  },
  {
    version: 4,
    description: 'favorites (movies / series / live) with snapshot for offline display',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS favorites (
        kind                TEXT NOT NULL,            -- 'movie' | 'series' | 'live'
        item_id             INTEGER NOT NULL,         -- stream_id (movie/live) or series_id
        name                TEXT NOT NULL,            -- snapshot (survives a catalog purge)
        image               TEXT,                     -- poster / cover / channel logo snapshot
        container_extension TEXT,                     -- snapshot (movie/live; for play/download)
        category_id         TEXT,                     -- snapshot
        added_at            INTEGER NOT NULL,
        PRIMARY KEY (kind, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_kind ON favorites(kind, added_at);
    `
  },
  {
    version: 5,
    description: 'programme reminders & scheduled recordings (live TV)',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS programme_reminders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id     INTEGER NOT NULL,          -- live channel stream id
        channel_name  TEXT NOT NULL,             -- snapshot for display
        channel_icon  TEXT,                      -- snapshot logo url
        epg_id        TEXT,                       -- provider id if present (unstable)
        title         TEXT NOT NULL,             -- programme title snapshot
        description   TEXT,                       -- programme description snapshot
        start_secs    INTEGER NOT NULL,          -- programme start (epoch seconds)
        end_secs      INTEGER NOT NULL,          -- programme end (epoch seconds)
        lead_secs     INTEGER NOT NULL,          -- notify this many seconds BEFORE start
        mode          TEXT NOT NULL,             -- 'notify' | 'record' | 'notify_record'
        status        TEXT NOT NULL DEFAULT 'scheduled',
        file_path     TEXT,                       -- recording file once it exists
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      -- Natural-key dedupe: one reminder per (channel, start, title).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_natural
        ON programme_reminders(stream_id, start_secs, title);
      CREATE INDEX IF NOT EXISTS idx_reminders_status ON programme_reminders(status);
      CREATE INDEX IF NOT EXISTS idx_reminders_start  ON programme_reminders(start_secs);
    `
  },
  {
    version: 6,
    description: 'movie file checks (real size) + drop movie details cached with a wrong runtime',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS vod_file_check (
        stream_id     INTEGER PRIMARY KEY,
        size_bytes    INTEGER NOT NULL,   -- from Content-Range of a 1-byte request
        duration_secs INTEGER,            -- runtime at check time (for the verdict)
        checked_at    INTEGER NOT NULL    -- epoch ms
      );
      -- Runtimes were read from duration_secs, which this provider fills with
      -- MINUTES; the parser now prefers "HH:MM:SS". The cache is refetched on demand.
      DELETE FROM vod_info_cache;
    `
  },
  {
    version: 7,
    description: 'full programme guide (xmltv.php) for searching inside live guides',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS epg_programmes (
        id              INTEGER PRIMARY KEY,
        epg_channel_id  TEXT NOT NULL,    -- matches live_streams.epg_channel_id
        start_secs      INTEGER NOT NULL,
        end_secs        INTEGER NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_epg_channel ON epg_programmes(epg_channel_id);
      CREATE INDEX IF NOT EXISTS idx_epg_end     ON epg_programmes(end_secs);
      -- Full-text index on title + description; accents/case-insensitive.
      CREATE VIRTUAL TABLE IF NOT EXISTS epg_fts USING fts5(
        title, description,
        content='epg_programmes', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS epg_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 8,
    description: 'movie file analysis: real resolution + codec (read by mpv)',
    up: /* sql */ `
      ALTER TABLE vod_file_check ADD COLUMN width INTEGER;
      ALTER TABLE vod_file_check ADD COLUMN height INTEGER;
      ALTER TABLE vod_file_check ADD COLUMN video_codec TEXT;
    `
  },
  {
    version: 9,
    description: 'watch progress: resume position / watched flag, recent live channels',
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS watch_progress (
        kind                TEXT NOT NULL,     -- 'movie' | 'series' (one episode) | 'live'
        item_id             INTEGER NOT NULL,  -- movie stream id / episode id / channel id
        position_secs       REAL NOT NULL DEFAULT 0,
        duration_secs       REAL,
        watched             INTEGER NOT NULL DEFAULT 0,
        updated_at          INTEGER NOT NULL,  -- epoch ms
        name                TEXT NOT NULL,     -- snapshot, like favorites
        image               TEXT,
        container_extension TEXT,
        series_id           INTEGER,           -- for an episode
        PRIMARY KEY (kind, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_watch_progress_updated ON watch_progress(updated_at);
    `
  }
]

/** The schema version the running code expects (latest migration version). */
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
