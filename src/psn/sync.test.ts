/**
 * Sync tests use MOCK PSN responses only. They verify our handling logic; they do not
 * (and cannot) prove the live PSN service behaves this way. The live check is the
 * ignored Rust test `live_psn_round_trip`, which needs a real NPSSO.
 */
import { describe, expect, it } from "vitest";
import { setManualStatus } from "../db/repo/status";
import { GTA_SET, gtaBundle, gtaDb, MOCK_PS4_TITLE, MOCK_PS5_TITLE, mockGateway, mockResponses, tid } from "../test/fixtures";
import { autoBind, evaluateCandidates } from "./binding";
import { parseTitles } from "./schemas";
import { bindingCandidates, bindSet, BindingError, fetchTitles, syncSet } from "./sync";

async function boundDb() {
  const db = await gtaDb();
  const { titles } = parseTitles([MOCK_PS4_TITLE, MOCK_PS5_TITLE]);
  await bindSet(db, GTA_SET, titles.find((t) => t.npServiceName === "trophy2")!);
  return db;
}

describe("PS4 vs PS5 trophy-set separation", () => {
  it("auto-binds only the PS5 (trophy2) list even though names and counts are identical", async () => {
    const db = await gtaDb();
    const { titles } = await fetchTitles(mockGateway());
    const cands = await bindingCandidates(db, GTA_SET, titles);
    const ps4 = cands.find((c) => c.title.npServiceName === "trophy")!;
    const ps5 = cands.find((c) => c.title.npServiceName === "trophy2")!;
    expect(ps5.accepted).toBe(true);
    expect(ps4.accepted).toBe(false);
    expect(ps4.reasons.join(" ")).toMatch(/PS4/);
    expect(autoBind({ title: "Grand Theft Auto V", platform: "PS5", npServiceName: "trophy2" }, titles)?.npCommunicationId).toBe("NPWR99990_00");
  });

  it("refuses to bind the PS4 list to the PS5 game", async () => {
    const db = await gtaDb();
    const { titles } = parseTitles([MOCK_PS4_TITLE]);
    await expect(bindSet(db, GTA_SET, titles[0])).rejects.toBeInstanceOf(BindingError);
  });

  it("does not auto-bind when the PS5 list's trophy counts differ, but lets the user confirm with a warning", () => {
    const { titles } = parseTitles([{ ...MOCK_PS5_TITLE, definedTrophies: { bronze: 42, silver: 5, gold: 3, platinum: 1 } }]);
    const target = { title: "Grand Theft Auto V", platform: "PS5" as const, npServiceName: "trophy2" as const, expectedCounts: { platinum: 1, gold: 3, silver: 15, bronze: 59 } };
    const c = evaluateCandidates(target, titles);
    expect(c[0].accepted).toBe(true);
    expect(c[0].confidence).toBe("likely");
    expect(c[0].reasons.join(" ")).toMatch(/Warning/);
    expect(autoBind(target, titles)).toBeNull();
  });

  it("drops malformed title entries instead of trusting them", () => {
    const { titles, rejected } = parseTitles([MOCK_PS5_TITLE, { npCommunicationId: "x" }, null]);
    expect(titles).toHaveLength(1);
    expect(rejected).toBe(2);
  });
});

describe("trophy sync", () => {
  it("writes VERIFIED states only after a successful sync", async () => {
    const db = await boundDb();
    const before = await gtaBundle(db);
    expect(before.trophies.every((t) => t.status.state === "UNVERIFIED")).toBe(true);

    const gw = mockGateway({ responses: mockResponses({ 1: "2026-10-20T19:00:00Z", 6: "2026-10-20T21:00:00Z" }) });
    const res = await syncSet(db, gw, GTA_SET);
    expect(res.ok).toBe(true);
    expect(res.importedEarned).toBe(2);

    const b = await gtaBundle(db);
    const welcome = b.trophies.find((t) => t.trophy.id === tid(1))!;
    expect(welcome.status.state).toBe("VERIFIED_EARNED");
    expect(welcome.status.earnedAt).toBe("2026-10-20T19:00:00Z");
    expect(welcome.trophy.factsSource).toBe("psn");
    expect(b.trophies.find((t) => t.trophy.id === tid(2))!.status.state).toBe("VERIFIED_LOCKED");
    expect(b.sync?.status).toBe("ok");
    expect(b.set.idsVerified).toBe(true);
  });

  it("preserves previous verified data when a later sync fails", async () => {
    const db = await boundDb();
    await syncSet(db, mockGateway({ responses: mockResponses({ 1: "2026-10-20T19:00:00Z" }) }), GTA_SET);
    const failing = mockGateway({
      userEarned: async () => {
        throw { kind: "timeout", message: "PlayStation Network did not respond in time." };
      },
    });
    const res = await syncSet(db, failing, GTA_SET);
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("timeout");
    const b = await gtaBundle(db);
    const welcome = b.trophies.find((t) => t.trophy.id === tid(1))!;
    expect(welcome.status.state).toBe("SYNC_ERROR");
    expect(welcome.status.earned).toBe(true);
    expect(welcome.status.previous?.confirmedAt).toBeTruthy();
    const locked = b.trophies.find((t) => t.trophy.id === tid(2))!;
    expect(locked.status.earned).toBe(false); // previous verified 'locked' kept, not unknown
    expect(b.sync?.lastError).toMatch(/did not respond/);
    expect(b.sync?.lastSuccessAt).toBeTruthy();
  });

  it("rejects an invalid PSN response without changing anything", async () => {
    const db = await boundDb();
    const bad = mockGateway({ userEarned: async () => ({ trophies: [{ trophyId: "one", earned: "yes" }] }) });
    const res = await syncSet(db, bad, GTA_SET);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/unexpected format/);
    const b = await gtaBundle(db);
    expect(b.trophies.every((t) => t.status.state === "SYNC_ERROR" && t.status.earned === null)).toBe(true);
  });

  it("refuses to sync an unlinked set and never reports success", async () => {
    const db = await gtaDb();
    const res = await syncSet(db, mockGateway(), GTA_SET);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not linked/);
  });

  it("never modifies manual marks", async () => {
    const db = await boundDb();
    await setManualStatus(db, tid(3), "earned");
    await syncSet(db, mockGateway(), GTA_SET);
    const rows = await db.select<{ manual_state: string; psn_state: string }>("SELECT manual_state, psn_state FROM trophy_status WHERE trophy_id = ?", [tid(3)]);
    expect(rows[0]).toEqual({ manual_state: "earned", psn_state: "locked" });
  });

  it("reports newly earned trophies on a later sync and records verified events", async () => {
    const db = await boundDb();
    await syncSet(db, mockGateway(), GTA_SET);
    const res = await syncSet(db, mockGateway({ responses: mockResponses({ 29: "2026-10-21T18:30:00Z" }) }), GTA_SET);
    expect(res.newlyEarned).toEqual(["Pimp My Sidearm"]);
    const ev = await db.select<{ source: string; earned_at: string }>("SELECT source, earned_at FROM status_events WHERE trophy_id = ? AND to_state='earned'", [tid(29)]);
    expect(ev).toEqual([{ source: "psn", earned_at: "2026-10-21T18:30:00Z" }]);
  });

  it("corrects inferred trophy IDs using PSN names", async () => {
    const db = await boundDb();
    const r = mockResponses({ 1: "2026-10-20T19:00:00Z" });
    // Simulate PSN numbering two trophies the other way round.
    const a = r.defs.trophies.find((t) => t.trophyId === 1)!;
    const b = r.defs.trophies.find((t) => t.trophyId === 2)!;
    [a.trophyId, b.trophyId] = [2, 1];
    const ea = r.earned.trophies.find((t) => t.trophyId === 1)!;
    const eb = r.earned.trophies.find((t) => t.trophyId === 2)!;
    [ea.trophyId, eb.trophyId] = [2, 1];
    const res = await syncSet(db, mockGateway({ responses: r }), GTA_SET);
    expect(res.ok).toBe(true);
    const rows = await db.select<{ name: string; psn_trophy_id: number }>("SELECT name, psn_trophy_id FROM trophies WHERE id IN (?, ?) ORDER BY id", [tid(1), tid(2)]);
    expect(rows.find((x) => x.name === "Welcome to Los Santos")!.psn_trophy_id).toBe(2);
    const bundle = await gtaBundle(db);
    expect(bundle.trophies.find((t) => t.trophy.name === "Welcome to Los Santos")!.status.state).toBe("VERIFIED_EARNED");
  });

  it("marks data stale after the threshold", async () => {
    const db = await boundDb();
    await syncSet(db, mockGateway(), GTA_SET);
    const later = await gtaBundle(db, new Date(Date.now() + 48 * 3600_000));
    expect(later.trophies[1].status.stale).toBe(true);
  });
});
