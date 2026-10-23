import { describe, expect, it } from "vitest";
import { buildPresence, type PresenceInput } from "./presence";

const NOW = new Date("2026-10-21T20:00:00Z");
const base: PresenceInput = {
  session: { status: "active", activeMs: 30 * 60_000 },
  game: { title: "Grand Theft Auto V", platform: "PS5", coverUrl: "https://image.api.playstation.com/x.png", hasPlatinum: true },
  progress: { earned: 34, total: 50 },
  nextTrophy: "Three Man Army",
  options: { showProgress: true, showNextTrophy: true, showWhenIdle: false },
  now: NOW,
};

describe("Discord presence", () => {
  it("shows the hunt, progress, next trophy and an elapsed timer of active play", () => {
    const p = buildPresence(base)!;
    expect(p.details).toBe("Hunting the Grand Theft Auto V Platinum");
    expect(p.state).toBe("34/50 trophies · Next: Three Man Army");
    expect(p.startMs).toBe(NOW.getTime() - 30 * 60_000);
    expect(p.largeImage).toMatch(/^https:/);
  });

  it("drops the timer and next trophy while paused", () => {
    const p = buildPresence({ ...base, session: { status: "paused", activeMs: 1 } })!;
    expect(p.startMs).toBeUndefined();
    expect(p.state).toBe("Paused · 34/50 trophies");
  });

  it("respects privacy options", () => {
    const p = buildPresence({ ...base, options: { showProgress: false, showNextTrophy: false, showWhenIdle: false } })!;
    expect(p.state).toBeUndefined();
  });

  it("clears when idle unless the user opted in", () => {
    expect(buildPresence({ ...base, session: null })).toBeNull();
    expect(buildPresence({ ...base, session: null, options: { ...base.options, showWhenIdle: true } })?.details).toMatch(/Planning/);
  });

  it("never sends non-https images", () => {
    expect(buildPresence({ ...base, game: { ...base.game!, coverUrl: "http://x/y.png" } })!.largeImage).toBeUndefined();
  });
});
