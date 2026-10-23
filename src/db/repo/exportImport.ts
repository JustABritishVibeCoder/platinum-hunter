/**
 * JSON export / import of all local data.
 *
 * - Secrets are never in the database (the PSN refresh token lives in Windows
 *   Credential Manager), so exports cannot leak them.
 * - Imports are validated: known format marker, supported schema version, whitelisted
 *   tables and columns, scalar values only, size limits. The replace happens in a
 *   single transaction, so a bad file leaves existing data untouched.
 */
import { z } from "zod";
import type { SqlDriver, SqlStatement, SqlValue } from "../driver";
import { LATEST_SCHEMA_VERSION } from "../migrations";

export const EXPORT_FORMAT = "platinum-hunter-export";

/** Parent tables first, so inserts satisfy foreign keys. */
export const TABLE_COLUMNS: Record<string, string[]> = {
  settings: ["key", "value", "updated_at"],
  games: ["id", "title", "platform", "edition", "region", "cover_url", "source", "is_sample", "catalog_id", "created_at", "updated_at"],
  game_meta: ["game_id", "data"],
  trophy_sets: [
    "id", "game_id", "platform", "np_communication_id", "np_service_name", "np_title_ids", "trophy_set_version", "binding_status",
    "dataset_source", "dataset_source_url", "dataset_retrieved_at", "dataset_completeness", "dataset_notes", "ids_verified",
  ],
  trophy_groups: ["set_id", "group_key", "psn_group_id", "name", "required_for_platinum", "sort_order"],
  trophies: [
    "id", "set_id", "game_id", "psn_trophy_id", "group_key", "name", "description", "grade", "hidden", "icon_url", "facts_source",
    "facts_verified_at", "psn_earned_rate", "psn_rarity", "community_earned_rate", "community_rate_source", "community_rate_retrieved_at", "sort_order",
  ],
  trophy_guidance: ["trophy_id", "category", "game_mode", "difficulty", "minutes", "missable", "online_required", "multiplayer", "phase", "data", "source", "source_date"],
  trophy_status: ["trophy_id", "psn_state", "psn_earned_at", "psn_confirmed_at", "psn_progress", "psn_progress_target", "manual_state", "manual_updated_at"],
  status_events: ["id", "trophy_id", "at", "source", "from_state", "to_state", "earned_at", "session_id"],
  sync_state: ["set_id", "status", "last_attempt_at", "last_success_at", "last_error", "last_error_at"],
  sync_log: ["id", "set_id", "started_at", "finished_at", "ok", "message", "changes"],
  user_progress: ["game_id", "key", "value", "updated_at"],
  sessions: ["id", "game_id", "started_at", "ended_at", "status", "notes", "is_sample"],
  session_segments: ["id", "session_id", "started_at", "ended_at"],
  session_objectives: ["session_id", "trophy_id", "added_at"],
  recommendation_skips: ["trophy_id", "skipped_at", "until"],
  game_focus: ["game_id", "trophy_id", "set_at"],
  trophy_notes: ["trophy_id", "note", "updated_at"],
};
const TABLES = Object.keys(TABLE_COLUMNS);
const MAX_ROWS = 250_000;

const scalar = z.union([z.string().max(1_000_000), z.number(), z.null()]);

export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  app: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), scalar))),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

export async function exportData(db: SqlDriver): Promise<ExportFile> {
  const tables: ExportFile["tables"] = {};
  for (const t of TABLES) {
    tables[t] = await db.select<Record<string, SqlValue>>(`SELECT ${TABLE_COLUMNS[t].join(", ")} FROM ${t}`);
  }
  return { format: EXPORT_FORMAT, schemaVersion: LATEST_SCHEMA_VERSION, exportedAt: new Date().toISOString(), app: "Platinum Hunter", tables };
}

export interface ImportCheck {
  ok: boolean;
  errors: string[];
  file?: ExportFile;
  summary?: Record<string, number>;
}

export function checkImport(text: string): ImportCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON (it may be corrupt or truncated)."] };
  }
  const parsed = exportFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "file"}: ${i.message}`),
    };
  }
  const file = parsed.data;
  const errors: string[] = [];
  if (file.schemaVersion > LATEST_SCHEMA_VERSION) {
    errors.push(`This export is from a newer Platinum Hunter (schema v${file.schemaVersion}). Update the app first.`);
  }
  let total = 0;
  const summary: Record<string, number> = {};
  for (const [table, rows] of Object.entries(file.tables)) {
    const cols = TABLE_COLUMNS[table];
    if (!cols) {
      errors.push(`Unknown table "${table}".`);
      continue;
    }
    total += rows.length;
    summary[table] = rows.length;
    const allowed = new Set(cols);
    for (const row of rows.slice(0, MAX_ROWS)) {
      const bad = Object.keys(row).find((k) => !allowed.has(k));
      if (bad) {
        errors.push(`Table "${table}" has an unknown column "${bad}".`);
        break;
      }
    }
  }
  if (total > MAX_ROWS) errors.push(`The export has too many rows (${total}).`);
  if (!file.tables.games) errors.push("The export contains no games table.");
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], file, summary };
}

/** Replaces ALL local data with the export's contents, atomically. */
export async function importData(db: SqlDriver, file: ExportFile): Promise<void> {
  const st: SqlStatement[] = [];
  for (const t of [...TABLES].reverse()) st.push({ sql: `DELETE FROM ${t}` });
  for (const t of TABLES) {
    const rows = file.tables[t] ?? [];
    for (const row of rows) {
      const cols = TABLE_COLUMNS[t].filter((c) => c in row);
      if (!cols.length) continue;
      st.push({
        sql: `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        params: cols.map((c) => row[c] ?? null),
      });
    }
  }
  await db.batch(st);
}
