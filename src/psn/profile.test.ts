import { describe, expect, it } from "vitest";
import { freshDb } from "../test/fixtures";
import { exportData } from "../db/repo/exportImport";
import { clearProfile, loadProfile, parseProfile, saveProfile, tierForLevel, tierGrade } from "./profile";

/** MOCK response shaped per the psn-api models; not real account data. */
const MOCK = {
  summary: { accountId: "1234567890123456789", trophyLevel: "412", progress: 37, tier: 5, earnedTrophies: { bronze: 900, silver: 250, gold: 80, platinum: 12 } },
  profile: {
    onlineId: "Mock_Hunter",
    aboutMe: "",
    avatars: [
      { size: "s", url: "http://static-resource.np.community.playstation.net/avatar/mock_s.png" },
      { size: "xl", url: "http://static-resource.np.community.playstation.net/avatar/mock_xl.png" },
    ],
    languages: ["en-US"],
    isPlus: true,
    isOfficiallyVerified: false,
    isMe: true,
  },
};

describe("PSN profile", () => {
  it("parses the profile, picks the largest avatar and forces https", () => {
    const p = parseProfile(MOCK);
    expect(p.onlineId).toBe("Mock_Hunter");
    expect(p.trophyLevel).toBe(412);
    expect(p.tier).toBe(5);
    expect(p.avatarUrl).toBe("https://static-resource.np.community.playstation.net/avatar/mock_xl.png");
    expect(p.earned.platinum).toBe(12);
  });

  it("rejects malformed responses and non-PlayStation avatar hosts", () => {
    expect(() => parseProfile({ summary: {}, profile: {} })).toThrow();
    const p = parseProfile({ ...MOCK, profile: { ...MOCK.profile, avatars: [{ size: "xl", url: "https://evil.example.com/a.png" }] } });
    expect(p.avatarUrl).toBeNull();
  });

  it("maps levels to Sony's tiers", () => {
    expect(tierForLevel(1)).toBe(1);
    expect(tierForLevel(350)).toBe(4);
    expect(tierForLevel(850)).toBe(9);
    expect(tierForLevel(999)).toBe(10);
    expect(tierGrade(5)).toBe("silver");
    expect(tierGrade(10)).toBe("platinum");
  });

  it("caches locally, clears on disconnect, and is never exported", async () => {
    const db = await freshDb();
    await saveProfile(db, parseProfile(MOCK));
    expect((await loadProfile(db))?.onlineId).toBe("Mock_Hunter");
    expect(JSON.stringify(await exportData(db))).not.toContain("Mock_Hunter");
    await clearProfile(db);
    expect(await loadProfile(db)).toBeNull();
  });
});
