/**
 * DEVELOPMENT-ONLY driver used when the UI runs in a normal browser (`npm run dev`)
 * instead of the Tauri shell. It runs the real migrations and catalog against an
 * in-memory SQLite (sql.js). Nothing is persisted, and the UI shows a banner saying so.
 * Production builds never include this module (see `services.ts`).
 */
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { SqlDriver, SqlStatement, SqlValue } from "./driver";

export async function createPreviewDriver(): Promise<SqlDriver> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  const isScript = (sql: string, params?: SqlValue[]) => (!params || !params.length) && sql.trim().replace(/;\s*$/, "").includes(";");
  const run = (sql: string, params: SqlValue[] = []) => {
    if (isScript(sql, params)) db.exec(sql);
    else db.run(sql, params);
    const changes = db.getRowsModified();
    const id = db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0];
    return { rowsAffected: changes, lastInsertId: Number(id ?? 0) };
  };
  return {
    async select<T>(sql: string, params: SqlValue[] = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      stmt.free();
      return out;
    },
    async execute(sql: string, params: SqlValue[] = []) {
      return run(sql, params);
    },
    async batch(statements: SqlStatement[]) {
      db.run("BEGIN");
      try {
        for (const s of statements) run(s.sql, s.params ?? []);
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    },
  };
}
