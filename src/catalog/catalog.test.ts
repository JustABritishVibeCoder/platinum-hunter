import { describe, expect, it } from "vitest";
import raw from "./data/gta-v-ps5.json";
import { parseCatalog } from "./schema";

describe("GTA V PS5 catalog", () => {
  const parsed = parseCatalog(raw);

  it("passes schema validation", () => {
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(parsed.ok).toBe(true);
  });

  it("is the PS5 trophy2 list, not the PS4 list", () => {
    if (!parsed.ok) throw new Error("invalid");
    const c = parsed.catalog;
    expect(c.game.platform).toBe("PS5");
    expect(c.trophySet.npServiceName).toBe("trophy2");
    // PS4 title IDs start with CUSA; none may appear in the PS5 dataset.
    expect(c.trophySet.npTitleIds.every((id) => id.startsWith("PPSA"))).toBe(true);
  });

  it("has 78 trophies matching the published grade counts", () => {
    if (!parsed.ok) throw new Error("invalid");
    const c = parsed.catalog;
    expect(c.trophies).toHaveLength(78);
    const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const t of c.trophies) counts[t.grade]++;
    expect(counts).toEqual({ platinum: 1, gold: 3, silver: 15, bronze: 59 });
  });

  it("has 51 base-game trophies (incl. Platinum) and only those count for the Platinum", () => {
    if (!parsed.ok) throw new Error("invalid");
    const c = parsed.catalog;
    const required = new Set(c.groups.filter((g) => g.requiredForPlatinum).map((g) => g.key));
    const base = c.trophies.filter((t) => required.has(t.groupKey));
    expect(base).toHaveLength(51);
    expect(base.filter((t) => t.grade === "platinum")).toHaveLength(1);
    const byGroup = Object.groupBy(c.trophies, (t) => t.groupKey);
    expect(byGroup["heists"]?.length).toBe(9);
    expect(byGroup["rockstar-editor"]?.length).toBe(10);
    expect(byGroup["doomsday"]?.length).toBe(8);
  });

  it("uses contiguous trophy ids 0..77", () => {
    if (!parsed.ok) throw new Error("invalid");
    const ids = parsed.catalog.trophies.map((t) => t.psnTrophyId).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 78 }, (_, i) => i));
  });

  it("gives every trophy guidance, a summary and at least one https guide link", () => {
    if (!parsed.ok) throw new Error("invalid");
    for (const t of parsed.catalog.trophies) {
      expect(t.guidance, t.name).not.toBeNull();
      expect(t.guidance!.guides.length, t.name).toBeGreaterThan(0);
      for (const g of t.guidance!.guides) expect(g.url.startsWith("https://")).toBe(true);
    }
  });

  it("flags every missable with a cited source", () => {
    if (!parsed.ok) throw new Error("invalid");
    const missables = parsed.catalog.trophies.filter((t) => t.guidance?.missable);
    expect(missables.map((t) => t.name).sort()).toEqual(
      [
        "Altruist Acolyte",
        "Kifflom!",
        "Red Mist",
        "TP Industries Arms Race",
        "Three Man Army",
        "To Live or Die in Los Santos",
        "Wanted: Alive or Alive",
      ].sort(),
    );
    for (const t of missables) expect(t.guidance!.missable!.sourceUrl).toMatch(/^https:\/\//);
  });

  it("rejects a tampered dataset that claims completeness with wrong counts", () => {
    const broken = structuredClone(raw) as { trophies: unknown[] };
    broken.trophies = broken.trophies.slice(0, 70);
    const res = parseCatalog(broken);
    expect(res.ok).toBe(false);
  });

  it("rejects non-https guide links and unknown prerequisite references", () => {
    const broken = structuredClone(raw) as { trophies: { guidance: { guides: { url: string }[]; prereqs: unknown[] } }[] };
    broken.trophies[1].guidance.guides[0].url = "http://example.com/guide";
    expect(parseCatalog(broken).ok).toBe(false);
    const broken2 = structuredClone(raw) as typeof broken;
    broken2.trophies[1].guidance.prereqs = [{ type: "story", checkpoint: "does_not_exist" }];
    expect(parseCatalog(broken2).ok).toBe(false);
  });
});
