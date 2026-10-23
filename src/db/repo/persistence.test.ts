import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCatalog } from "../../catalog";
import { GTA_ID, gtaDb, tempDir, tid } from "../../test/fixtures";
import { openNodeDriver } from "../../test/nodeDriver";
import { migrate } from "../migrations";
import { installCatalog } from "./catalogImport";
import { checkImport, exportData, importData } from "./exportImport";
import { addManualTrophy, createManualGame, listGames, loadBundle } from "./games";
import { setCounter, setStoryIndex } from "./progress";
import { installSampleData, removeSampleData } from "./sample";
import { loadSettings, saveSettings } from "./settings";
import { setManualStatus } from "./status";

describe("persistence after restart", () => {
  it("keeps games, statuses, progress and settings across reopen", async () => {
    const { dir, cleanup } = tempDir();
    try {
      const path = join(dir, "app.db");
      const db = await gtaDb(path);
      await setManualStatus(db, tid(1), "earned");
      await setStoryIndex(db, GTA_ID, 14);
      await setCounter(db, GTA_ID, "online_rank", 42);
      await saveSettings(db, { defaultMode: "quickest", accent: "ice" });
      db.close();

      const db2 = openNodeDriver(path);
      expect(await migrate(db2)).toEqual([]);
      const b = (await loadBundle(db2, GTA_ID))!;
      expect(b.trophies).toHaveLength(78);
      expect(b.trophies.find((t) => t.trophy.id === tid(1))!.status.state).toBe("MANUAL");
      expect(b.progress.storyIndex).toBe(14);
      expect(b.progress.counters.online_rank).toBe(42);
      const s = await loadSettings(db2);
      expect(s.defaultMode).toBe("quickest");
      expect(s.accent).toBe("ice");
      db2.close();
    } finally {
      cleanup();
    }
  });

  it("re-installing the catalog keeps the player's statuses", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(6), "earned");
    await installCatalog(db, findCatalog(GTA_ID)!);
    const b = (await loadBundle(db, GTA_ID))!;
    expect(b.trophies.find((t) => t.trophy.id === tid(6))!.status.earned).toBe(true);
    expect(b.trophies).toHaveLength(78);
  });
});

describe("manual games", () => {
  it("creates a game with manual trophies that are never verified", async () => {
    const db = await gtaDb();
    const id = await createManualGame(db, { title: "My Indie Game", platform: "PS4", edition: "Digital" });
    const t = await addManualTrophy(db, id, { name: "Beat it", description: "Finish the game", grade: "gold" });
    await setManualStatus(db, t, "earned");
    const b = (await loadBundle(db, id))!;
    expect(b.set.npServiceName).toBe("trophy");
    expect(b.trophies[0].trophy.factsSource).toBe("manual");
    expect(b.trophies[0].status.state).toBe("MANUAL");
  });
});

describe("sample data", () => {
  it("is flagged, excluded from the real library, and removable", async () => {
    const db = await gtaDb();
    await installSampleData(db);
    expect((await listGames(db)).map((g) => g.id)).toEqual([GTA_ID]);
    expect((await listGames(db, { includeSample: true })).length).toBe(2);
    await removeSampleData(db);
    expect((await listGames(db, { includeSample: true })).length).toBe(1);
    expect(await db.select("SELECT * FROM sessions WHERE is_sample = 1")).toHaveLength(0);
  });
});

describe("export / import validation", () => {
  it("round-trips all data", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(1), "earned");
    const file = await exportData(db);
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/refresh_token|npsso|access_token/i);

    const db2 = await gtaDb();
    const check = checkImport(text);
    expect(check.ok).toBe(true);
    await importData(db2, check.file!);
    const b = (await loadBundle(db2, GTA_ID))!;
    expect(b.trophies.find((t) => t.trophy.id === tid(1))!.status.state).toBe("MANUAL");
  });

  it("rejects corrupt, foreign, future and tampered files", async () => {
    expect(checkImport("{not json").ok).toBe(false);
    expect(checkImport(JSON.stringify({ hello: "world" })).ok).toBe(false);
    const db = await gtaDb();
    const file = await exportData(db);
    expect(checkImport(JSON.stringify({ ...file, schemaVersion: 999 })).ok).toBe(false);
    const evil = structuredClone(file);
    evil.tables.games[0]["id; DROP TABLE games"] = "x";
    const res = checkImport(JSON.stringify(evil));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/unknown column/);
    expect(checkImport(JSON.stringify({ ...file, tables: { ...file.tables, sqlite_master: [] } })).ok).toBe(false);
  });

  it("leaves existing data untouched when an import fails part-way", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(1), "earned");
    const file = await exportData(db);
    // A row violating a CHECK constraint makes the transaction fail.
    file.tables.trophy_status.push({ trophy_id: tid(2), psn_state: "definitely-earned" });
    await expect(importData(db, file)).rejects.toThrow();
    const b = (await loadBundle(db, GTA_ID))!;
    expect(b.trophies.find((t) => t.trophy.id === tid(1))!.status.earned).toBe(true);
  });
});
