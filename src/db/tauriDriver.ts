import { invoke } from "@tauri-apps/api/core";
import type { SqlDriver, SqlStatement, SqlValue } from "./driver";

/** SqlDriver backed by the Rust SQLite layer (`src-tauri/src/db.rs`). */
export const tauriDriver: SqlDriver = {
  select<T>(sql: string, params: SqlValue[] = []) {
    return invoke<T[]>("db_select", { sql, params });
  },
  execute(sql: string, params: SqlValue[] = []) {
    return invoke<{ rowsAffected: number; lastInsertId: number }>("db_execute", { sql, params });
  },
  batch(statements: SqlStatement[]) {
    return invoke<void>("db_batch", {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
  },
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
