import { describe, expect, it } from "vitest";
import { openNodeDriver } from "../test/nodeDriver";
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, migrate, MIGRATIONS, type Migration } from "./migrations";

describe("database migrations", () => {
  it("applies all migrations to an empty database and records them", async () => {
    const db = openNodeDriver();
    const applied = await migrate(db);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = (await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
    for (const t of ["games", "trophy_sets", "trophies", "trophy_status", "sessions", "session_segments", "sync_state"]) {
      expect(tables).toContain(t);
    }
    const marker = await db.select<{ value: string }>("SELECT value FROM app_meta WHERE key='app'");
    expect(marker[0].value).toBe("platinum-hunter");
  });

  it("is idempotent", async () => {
    const db = openNodeDriver();
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
  });

  it("applies only new migrations to an existing database and keeps data", async () => {
    const db = openNodeDriver();
    await migrate(db);
    await db.execute(
      "INSERT INTO games (id,title,platform,edition,source,created_at,updated_at) VALUES ('g','T','PS5','E','manual','x','x')",
    );
    const next: Migration = { version: LATEST_SCHEMA_VERSION + 1, name: "add column", sql: "ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;" };
    expect(await migrate(db, [...MIGRATIONS, next])).toEqual([next.version]);
    const rows = await db.select<{ favourite: number }>("SELECT favourite FROM games WHERE id='g'");
    expect(rows[0].favourite).toBe(0);
  });

  it("rolls back a failing migration completely", async () => {
    const db = openNodeDriver();
    await migrate(db);
    const bad: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: "broken",
      sql: "CREATE TABLE half_done (x INTEGER); INSERT INTO no_such_table VALUES (1);",
    };
    await expect(migrate(db, [...MIGRATIONS, bad])).rejects.toThrow();
    expect(await currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const t = await db.select("SELECT name FROM sqlite_master WHERE name='half_done'");
    expect(t).toHaveLength(0);
  });

  it("refuses to run against a database from a newer app version", async () => {
    const db = openNodeDriver();
    await migrate(db);
    await db.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 'x')");
    await expect(migrate(db)).rejects.toThrow(/newer version/);
  });
});
