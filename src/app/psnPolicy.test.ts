import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../db/repo/settings";
import { cooldownRemainingMs, formatCooldown, SYNC_COOLDOWN_MS } from "./psnPolicy";

describe("PSN usage policy", () => {
  const now = new Date("2026-10-23T12:00:00Z");

  it("is opt-in: PSN sync is off by default", () => {
    expect(DEFAULT_SETTINGS.psn.optIn).toBe(false);
  });

  it("allows a sync when there has never been one", () => {
    expect(cooldownRemainingMs(null, now)).toBe(0);
  });

  it("blocks syncing for an hour after the last attempt", () => {
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(cooldownRemainingMs(tenMinAgo, now)).toBe(50 * 60_000);
    expect(formatCooldown(cooldownRemainingMs(tenMinAgo, now))).toBe("50 min");
  });

  it("counts failed attempts too, so errors can't cause rapid retries", () => {
    // The policy reads last_attempt_at, which is written before any request is made.
    const justNow = now.toISOString();
    expect(cooldownRemainingMs(justNow, now)).toBe(SYNC_COOLDOWN_MS);
  });

  it("allows syncing again once the hour has passed", () => {
    const anHourAgo = new Date(now.getTime() - SYNC_COOLDOWN_MS - 1000).toISOString();
    expect(cooldownRemainingMs(anHourAgo, now)).toBe(0);
  });
});
