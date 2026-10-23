import { describe, expect, it } from "vitest";
import { resolveStatus } from "./status";
import type { SetSyncState, TrophyStatusRecord } from "./types";

const rec = (r: Partial<TrophyStatusRecord>): TrophyStatusRecord => ({
  trophyId: "t",
  psnState: null,
  psnEarnedAt: null,
  psnConfirmedAt: null,
  psnProgress: null,
  psnProgressTarget: null,
  manualState: null,
  manualUpdatedAt: null,
  ...r,
});
const sync = (s: Partial<SetSyncState>): SetSyncState => ({
  setId: "s",
  status: "ok",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastErrorAt: null,
  ...s,
});
const NOW = new Date("2026-10-21T12:00:00Z");

describe("trophy verification states", () => {
  it("is UNVERIFIED with unknown earned flag when there is no data", () => {
    const s = resolveStatus(null, null, NOW);
    expect(s.state).toBe("UNVERIFIED");
    expect(s.earned).toBeNull();
  });

  it("reports VERIFIED_EARNED from a successful PSN result", () => {
    const s = resolveStatus(rec({ psnState: "earned", psnEarnedAt: "2026-10-20T10:00:00Z", psnConfirmedAt: "2026-10-21T11:00:00Z" }), sync({}), NOW);
    expect(s).toMatchObject({ state: "VERIFIED_EARNED", earned: true, basis: "psn", stale: false });
  });

  it("reports VERIFIED_LOCKED from a successful PSN result", () => {
    const s = resolveStatus(rec({ psnState: "locked", psnConfirmedAt: "2026-10-21T11:00:00Z" }), sync({}), NOW);
    expect(s).toMatchObject({ state: "VERIFIED_LOCKED", earned: false, basis: "psn" });
  });

  it("labels manual marks MANUAL, never VERIFIED", () => {
    const s = resolveStatus(rec({ manualState: "earned", manualUpdatedAt: "2026-10-21T10:00:00Z" }), null, NOW);
    expect(s.state).toBe("MANUAL");
    expect(s.basis).toBe("manual");
    expect(s.earned).toBe(true);
  });

  it("keeps the previous verified result and shows SYNC_ERROR after a failed sync", () => {
    const r = rec({ psnState: "earned", psnEarnedAt: "2026-10-01T00:00:00Z", psnConfirmedAt: "2026-10-20T00:00:00Z" });
    const s = resolveStatus(r, sync({ status: "error", lastErrorAt: "2026-10-21T09:00:00Z", lastError: "timeout" }), NOW);
    expect(s.state).toBe("SYNC_ERROR");
    expect(s.earned).toBe(true);
    expect(s.previous).toEqual({ state: "earned", confirmedAt: "2026-10-20T00:00:00Z" });
  });

  it("never turns a failed sync into a claim that a trophy is locked", () => {
    const s = resolveStatus(null, sync({ status: "error", lastErrorAt: "2026-10-21T09:00:00Z" }), NOW);
    expect(s.state).toBe("SYNC_ERROR");
    expect(s.earned).toBeNull();
  });

  it("marks verified data older than the threshold as stale", () => {
    const s = resolveStatus(rec({ psnState: "locked", psnConfirmedAt: "2026-10-18T00:00:00Z" }), sync({}), NOW, 24);
    expect(s.state).toBe("VERIFIED_LOCKED");
    expect(s.stale).toBe(true);
  });

  it("shows a newer manual 'earned' over an older verified 'locked', as MANUAL with a conflict", () => {
    const r = rec({ psnState: "locked", psnConfirmedAt: "2026-10-20T00:00:00Z", manualState: "earned", manualUpdatedAt: "2026-10-21T08:00:00Z" });
    const s = resolveStatus(r, sync({}), NOW);
    expect(s.state).toBe("MANUAL");
    expect(s.conflict).toBe(true);
  });

  it("lets a later PSN 'locked' override an older manual 'earned', flagging the conflict", () => {
    const r = rec({ psnState: "locked", psnConfirmedAt: "2026-10-21T11:00:00Z", manualState: "earned", manualUpdatedAt: "2026-10-20T08:00:00Z" });
    const s = resolveStatus(r, sync({}), NOW);
    expect(s.state).toBe("VERIFIED_LOCKED");
    expect(s.conflict).toBe(true);
  });

  it("PSN earned always wins over a manual 'locked'", () => {
    const r = rec({ psnState: "earned", psnConfirmedAt: "2026-10-20T00:00:00Z", manualState: "locked", manualUpdatedAt: "2026-10-21T00:00:00Z" });
    expect(resolveStatus(r, sync({}), NOW).state).toBe("VERIFIED_EARNED");
  });
});
