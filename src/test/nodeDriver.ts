/**
 * Test-only SqlDriver backed by Node's built-in SQLite. Exercises the exact same SQL
 * and migrations as the desktop app, against a real (file or in-memory) database.
 */
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlStatement, SqlValue } from "../db/driver";

export interface NodeDriver extends SqlDriver {
  close(): void;
}

export function openNodeDriver(path = ":memory:"): NodeDriver {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");

  const isScript = (sql: string, params?: SqlValue[]) =>
    (!params || params.length === 0) && sql.trim().replace(/;\s*$/, "").includes(";");

  const run = (sql: string, params: SqlValue[] = []) => {
    if (isScript(sql, params)) {
      db.exec(sql);
      return { rowsAffected: 0, lastInsertId: 0 };
    }
    const r = db.prepare(sql).run(...params);
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  };

  return {
    async select<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: SqlValue[] = []) {
      return run(sql, params);
    },
    async batch(statements: SqlStatement[]) {
      db.exec("BEGIN");
      try {
        for (const s of statements) run(s.sql, s.params ?? []);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
