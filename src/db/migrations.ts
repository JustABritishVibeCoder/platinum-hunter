/**
 * Versioned schema migrations. Each migration runs exactly once, inside a transaction
 * together with its `schema_migrations` record, so a failed migration leaves the
 * database untouched. Never edit a shipped migration: append a new one.
 */
import type { SqlDriver } from "./driver";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const APP_MARKER = "platinum-hunter";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('PS5','PS4','PS3','PSVITA','PSVR','PSVR2','PC')),
  edition TEXT NOT NULL,
  region TEXT,
  cover_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('catalog','psn','manual','sample')),
  is_sample INTEGER NOT NULL DEFAULT 0,
  catalog_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE game_meta (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

CREATE TABLE trophy_sets (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  np_communication_id TEXT UNIQUE,
  np_service_name TEXT CHECK (np_service_name IN ('trophy','trophy2')),
  np_title_ids TEXT NOT NULL DEFAULT '[]',
  trophy_set_version TEXT,
  binding_status TEXT NOT NULL DEFAULT 'unbound' CHECK (binding_status IN ('unbound','bound')),
  dataset_source TEXT,
  dataset_source_url TEXT,
  dataset_retrieved_at TEXT,
  dataset_completeness TEXT NOT NULL DEFAULT 'unknown' CHECK (dataset_completeness IN ('complete','partial','unknown')),
  dataset_notes TEXT,
  ids_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sets_game ON trophy_sets(game_id);

CREATE TABLE trophy_groups (
  set_id TEXT NOT NULL REFERENCES trophy_sets(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  psn_group_id TEXT,
  name TEXT NOT NULL,
  required_for_platinum INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (set_id, group_key)
);

CREATE TABLE trophies (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES trophy_sets(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  psn_trophy_id INTEGER NOT NULL,
  group_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('bronze','silver','gold','platinum')),
  hidden INTEGER NOT NULL DEFAULT 0,
  icon_url TEXT,
  facts_source TEXT NOT NULL CHECK (facts_source IN ('psn','catalog','manual','sample')),
  facts_verified_at TEXT,
  psn_earned_rate REAL,
  psn_rarity INTEGER,
  community_earned_rate REAL,
  community_rate_source TEXT,
  community_rate_retrieved_at TEXT,
  sort_order INTEGER NOT NULL,
  UNIQUE (set_id, psn_trophy_id)
);
CREATE INDEX idx_trophies_set ON trophies(set_id);
CREATE INDEX idx_trophies_game ON trophies(game_id);

CREATE TABLE trophy_guidance (
  trophy_id TEXT PRIMARY KEY REFERENCES trophies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  difficulty REAL,
  minutes INTEGER,
  missable INTEGER NOT NULL DEFAULT 0,
  online_required INTEGER NOT NULL DEFAULT 0,
  multiplayer TEXT NOT NULL DEFAULT 'none',
  phase TEXT,
  data TEXT NOT NULL,
  source TEXT,
  source_date TEXT
);

CREATE TABLE trophy_status (
  trophy_id TEXT PRIMARY KEY REFERENCES trophies(id) ON DELETE CASCADE,
  psn_state TEXT CHECK (psn_state IN ('earned','locked')),
  psn_earned_at TEXT,
  psn_confirmed_at TEXT,
  psn_progress TEXT,
  psn_progress_target TEXT,
  manual_state TEXT CHECK (manual_state IN ('earned','locked')),
  manual_updated_at TEXT
);

CREATE TABLE status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trophy_id TEXT NOT NULL REFERENCES trophies(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('psn','manual')),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK (to_state IN ('earned','locked')),
  earned_at TEXT,
  session_id TEXT
);
CREATE INDEX idx_events_trophy ON status_events(trophy_id, at);
CREATE INDEX idx_events_at ON status_events(at);

CREATE TABLE sync_state (
  set_id TEXT PRIMARY KEY REFERENCES trophy_sets(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('never','ok','error')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_progress (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, key)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','ended')),
  notes TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_game ON sessions(game_id, started_at);

CREATE TABLE session_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX idx_segments_session ON session_segments(session_id);

CREATE TABLE session_objectives (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trophy_id TEXT NOT NULL REFERENCES trophies(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (session_id, trophy_id)
);

CREATE TABLE recommendation_skips (
  trophy_id TEXT PRIMARY KEY REFERENCES trophies(id) ON DELETE CASCADE,
  skipped_at TEXT NOT NULL,
  until TEXT NOT NULL
);

CREATE TABLE game_focus (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  trophy_id TEXT NOT NULL REFERENCES trophies(id) ON DELETE CASCADE,
  set_at TEXT NOT NULL
);

CREATE TABLE trophy_notes (
  trophy_id TEXT PRIMARY KEY REFERENCES trophies(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function ensureBookkeeping(db: SqlDriver): Promise<void> {
  await db.batch([
    { sql: "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)" },
    { sql: "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)" },
    { sql: "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app', ?)", params: [APP_MARKER] },
  ]);
}

export async function currentSchemaVersion(db: SqlDriver): Promise<number> {
  await ensureBookkeeping(db);
  const rows = await db.select<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
  return rows[0]?.v ?? 0;
}

/** Applies pending migrations in order. Returns the versions that were applied. */
export async function migrate(db: SqlDriver, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const current = await currentSchemaVersion(db);
  const latestKnown = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latestKnown) {
    throw new Error(
      `The database was created by a newer version of Platinum Hunter (schema v${current}). Please update the app.`,
    );
  }
  const applied: number[] = [];
  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
  for (const m of pending) {
    await db.batch([
      { sql: m.sql },
      {
        sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        params: [m.version, m.name, new Date().toISOString()],
      },
    ]);
    applied.push(m.version);
  }
  return applied;
}
