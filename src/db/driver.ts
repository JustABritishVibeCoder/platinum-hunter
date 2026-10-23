/**
 * Minimal SQL driver contract used by every repository.
 *
 * In the desktop app this is backed by Rust/rusqlite via Tauri commands; in tests it is
 * backed by Node's built-in `node:sqlite`. Both bind parameters positionally (`?`), so
 * repositories never build SQL from values.
 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDriver {
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertId: number }>;
  /** Runs all statements in one transaction: all succeed or none are applied. */
  batch(statements: SqlStatement[]): Promise<void>;
}

/** Error shape produced by the Rust backend. */
export interface BackendError {
  kind: string;
  message: string;
  retryAfterSecs?: number;
}

export function isBackendError(e: unknown): e is BackendError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

export function errorMessage(e: unknown): string {
  if (isBackendError(e)) return e.message;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unexpected error";
}

export async function selectOne<T>(db: SqlDriver, sql: string, params?: SqlValue[]): Promise<T | null> {
  const rows = await db.select<T>(sql, params);
  return rows[0] ?? null;
}
