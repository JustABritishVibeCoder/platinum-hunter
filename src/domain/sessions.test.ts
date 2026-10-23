import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addObjective,
  endSession,
  getOpenSession,
  getSegments,
  listObjectives,
  listSessions,
  pauseSession,
  resumeSession,
  SessionError,
  startSession,
} from "../db/repo/sessions";
import { listEvents, setManualStatus } from "../db/repo/status";
import { GTA_ID, gtaDb, tempDir, tid } from "../test/fixtures";
import { openNodeDriver } from "../test/nodeDriver";
import { computeSessionStats, formatDuration, sessionDurationMs, trophiesForSession } from "./sessions";
import type { StatusEvent } from "./types";

const T0 = new Date("2026-10-21T18:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("session duration", () => {
  it("sums segments and counts an open segment up to now", () => {
    const segs = [
      { startedAt: at(0).toISOString(), endedAt: at(30).toISOString() },
      { startedAt: at(40).toISOString(), endedAt: null },
    ];
    expect(sessionDurationMs(segs, at(50))).toBe(40 * 60_000);
  });

  it("never returns negative durations for clock skew", () => {
    expect(sessionDurationMs([{ startedAt: at(10).toISOString(), endedAt: at(5).toISOString() }], at(20))).toBe(0);
  });

  it("formats durations", () => {
    expect(formatDuration(3_723_000)).toBe("01:02:03");
    expect(formatDuration(3_723_000, false)).toBe("1h 02m");
  });
});

describe("session lifecycle", () => {
  it("supports start, pause, resume and end, excluding paused time", async () => {
    const db = await gtaDb();
    const id = await startSession(db, GTA_ID, at(0));
    await pauseSession(db, id, at(20));
    await resumeSession(db, id, at(50));
    await endSession(db, id, at(80));
    const segs = await getSegments(db, id);
    expect(segs).toHaveLength(2);
    expect(sessionDurationMs(segs, at(1000))).toBe(50 * 60_000);
    expect(await getOpenSession(db)).toBeNull();
  });

  it("rejects invalid transitions", async () => {
    const db = await gtaDb();
    const id = await startSession(db, GTA_ID, at(0));
    await expect(resumeSession(db, id, at(1))).rejects.toBeInstanceOf(SessionError);
    await endSession(db, id, at(2));
    await expect(pauseSession(db, id, at(3))).rejects.toBeInstanceOf(SessionError);
  });

  it("keeps only one open session", async () => {
    const db = await gtaDb();
    const a = await startSession(db, GTA_ID, at(0));
    const b = await startSession(db, GTA_ID, at(10));
    expect((await getOpenSession(db))!.id).toBe(b);
    const all = await listSessions(db);
    expect(all.find((s) => s.session.id === a)!.session.status).toBe("ended");
  });

  it("continues accurately across an app restart (timestamps, not timers)", async () => {
    const { dir, cleanup } = tempDir();
    try {
      const path = join(dir, "restart.db");
      const db1 = await gtaDb(path);
      const id = await startSession(db1, GTA_ID, at(0));
      await addObjective(db1, id, tid(6), at(1));
      db1.close();

      // "Restart": reopen the same file 2 hours later.
      const db2 = openNodeDriver(path);
      const open = await getOpenSession(db2);
      expect(open?.id).toBe(id);
      expect(open?.status).toBe("active");
      expect(sessionDurationMs(await getSegments(db2, id), at(120))).toBe(120 * 60_000);
      expect(await listObjectives(db2, id)).toEqual([tid(6)]);
      db2.close();
    } finally {
      cleanup();
    }
  });
});

describe("trophies earned during a session", () => {
  const session = { id: "s1", startedAt: at(0).toISOString(), endedAt: at(60).toISOString() };
  const ev = (e: Partial<StatusEvent>): StatusEvent => ({
    id: 1,
    trophyId: "t1",
    at: at(70).toISOString(),
    source: "psn",
    fromState: "locked",
    toState: "earned",
    earnedAt: null,
    sessionId: null,
    ...e,
  });

  it("attributes PSN trophies by their verified earned timestamp", () => {
    const out = trophiesForSession(session, [ev({ earnedAt: at(30).toISOString() }), ev({ trophyId: "t2", earnedAt: at(90).toISOString() })]);
    expect(out).toEqual([{ trophyId: "t1", source: "psn", at: at(30).toISOString() }]);
  });

  it("attributes manual changes made during the session, labelled manual", () => {
    const out = trophiesForSession(session, [ev({ source: "manual", trophyId: "t3", sessionId: "s1", at: at(10).toISOString() })]);
    expect(out[0]).toMatchObject({ trophyId: "t3", source: "manual" });
  });

  it("prefers the PSN confirmation over a manual mark for the same trophy", () => {
    const out = trophiesForSession(session, [
      ev({ source: "manual", sessionId: "s1", at: at(10).toISOString() }),
      ev({ source: "psn", earnedAt: at(12).toISOString() }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("psn");
  });

  it("records the session on manual events and computes statistics", async () => {
    const db = await gtaDb();
    const id = await startSession(db, GTA_ID, at(0));
    await setManualStatus(db, tid(1), "earned", { sessionId: id, now: at(5) });
    await endSession(db, id, at(45));
    const events = await listEvents(db);
    const [row] = await listSessions(db);
    const trophies = trophiesForSession(row.session, events);
    expect(trophies).toHaveLength(1);
    const stats = computeSessionStats([{ ...row, trophies }]);
    expect(stats).toMatchObject({ count: 1, totalMs: 45 * 60_000, trophiesManual: 1, trophiesVerified: 0, trophiesPerSession: 1 });
  });
});
