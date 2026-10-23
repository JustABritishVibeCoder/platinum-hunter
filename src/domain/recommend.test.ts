import { describe, expect, it } from "vitest";
import { setCounter, setEnding, setFlag, setStoryIndex } from "../db/repo/progress";
import { skipTrophy } from "../db/repo/sessions";
import { setManualStatus } from "../db/repo/status";
import { GTA_ID, gtaBundle, gtaDb, tid } from "../test/fixtures";
import { computeCompletion } from "./completion";
import { buildRoadmap } from "./roadmap";
import { recommend } from "./recommend";

const NAMES = {
  welcome: 1,
  diamondHard: 6,
  pimp: 29,
  lsc: 31,
  trading: 28,
  threeManArmy: 24,
  redMist: 21,
  tpIndustries: 16,
  kifflom: 23,
  wanted: 30,
  altruist: 26,
  allsFare: 15,
  offThePlane: 33,
  numeroUno: 37,
  newPerspective: 50,
  careerCriminal: 13,
};

describe("recommendation engine", () => {
  it("never recommends earned trophies, the Platinum, or add-on trophies", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(NAMES.welcome), "earned");
    const r = recommend(await gtaBundle(db), "easiest");
    const ids = r.ranked.map((x) => x.trophy.trophy.psnTrophyId);
    expect(ids).not.toContain(NAMES.welcome);
    expect(ids).not.toContain(0);
    expect(r.ranked.every((x) => x.trophy.requiredForPlatinum)).toBe(true);
  });

  it("on a fresh install, only no-prerequisite trophies are 'available'; the rest are conditional, not falsely achievable", async () => {
    const db = await gtaDb();
    const r = recommend(await gtaBundle(db), "easiest");
    const available = r.ranked.filter((x) => x.tier <= 1);
    for (const a of available) expect(a.availability.hard.every((h) => h.status === "met")).toBe(true);
    const welcome = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.welcome)!;
    expect(welcome.tier).toBeLessThanOrEqual(1);
    const pimp = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.pimp)!;
    expect(pimp.tier).toBe(2);
    expect(pimp.questions[0].kind).toBe("story");
    expect(r.questions.length).toBeGreaterThan(0);
  });

  it("blocks trophies whose prerequisites are known to be incomplete", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 2); // completed Franklin and Lamar only
    const r = recommend(await gtaBundle(db), "easiest");
    const blockedIds = r.blocked.map((b) => b.trophy.trophy.psnTrophyId);
    expect(blockedIds).toContain(NAMES.pimp); // needs Complications
    expect(blockedIds).toContain(NAMES.redMist); // needs Trevor Philips Industries
    expect(r.ranked.map((x) => x.trophy.trophy.psnTrophyId)).not.toContain(NAMES.pimp);
    const pimp = r.blocked.find((b) => b.trophy.trophy.psnTrophyId === NAMES.pimp)!;
    expect(pimp.availability.reasons[0]).toMatch(/Complications/);
  });

  it("derives story progress from earned trophies (verified or manual)", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(NAMES.diamondHard), "earned"); // The Jewel Store Job done
    const r = recommend(await gtaBundle(db), "easiest");
    expect(r.context.storyLower).toBe(14);
    const pimp = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.pimp)!;
    expect(pimp.tier).toBe(0); // Complications (index 4) is before the Jewel Store Job
    expect(pimp.availability.hard[0].basis).toMatch(/Diamond Hard/);
  });

  it("EASIEST ranks by difficulty, QUICKEST by time", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 16); // Nervous Ron
    const b = await gtaBundle(db);
    const easy = recommend(b, "easiest").ranked.filter((x) => x.tier === 0);
    for (let i = 1; i < easy.length; i++) expect(easy[i - 1].difficulty.value!).toBeLessThanOrEqual(easy[i].difficulty.value!);
    const quick = recommend(b, "quickest").ranked.filter((x) => x.tier === 0);
    for (let i = 1; i < quick.length; i++) expect(quick[i - 1].time.minutes!).toBeLessThanOrEqual(quick[i].time.minutes!);
    expect(quick[0].reasons[0]).toMatch(/Shortest estimated time/);
  });

  it("BEST PROGRESS rewards trophies that unblock others", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 2);
    await setManualStatus(db, tid(NAMES.welcome), "earned");
    const r = recommend(await gtaBundle(db), "best_progress");
    const diamond = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.diamondHard)!;
    expect(diamond.unlocks.length).toBeGreaterThan(0);
    expect(diamond.reasons.some((s) => s.startsWith("Unblocks"))).toBe(true);
  });

  it("explains every recommendation and reports data provenance", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 16);
    const top = recommend(await gtaBundle(db), "easiest").ranked[0];
    expect(top.reasons.length).toBeGreaterThan(0);
    expect(top.provenance.unlockStatus).toMatch(/Unverified/);
    expect(top.provenance.estimates).toMatch(/editorial/i);
  });

  it("skipping deprioritises without removing or completing", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 16);
    const before = recommend(await gtaBundle(db), "easiest").ranked[0];
    await skipTrophy(db, before.trophy.trophy.id, 24);
    const after = recommend(await gtaBundle(db), "easiest");
    expect(after.ranked[0].trophy.trophy.id).not.toBe(before.trophy.trophy.id);
    const skipped = after.ranked.find((x) => x.trophy.trophy.id === before.trophy.trophy.id)!;
    expect(skipped.tier).toBe(3);
    expect(skipped.trophy.status.earned).not.toBe(true);
    // Skip expires
    const later = recommend(await gtaBundle(db), "easiest", { now: new Date(Date.now() + 25 * 3600_000) });
    expect(later.ranked.find((x) => x.trophy.trophy.id === before.trophy.trophy.id)!.tier).not.toBe(3);
  });

  it("recalculates after a trophy is confirmed earned", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 16);
    const first = recommend(await gtaBundle(db), "easiest").ranked[0];
    await setManualStatus(db, first.trophy.trophy.id, "earned");
    const next = recommend(await gtaBundle(db), "easiest");
    expect(next.ranked.map((x) => x.trophy.trophy.id)).not.toContain(first.trophy.trophy.id);
  });

  it("treats co-op trophies as conditional until the user confirms partners, and blocks them if not", async () => {
    const db = await gtaDb();
    await setFlag(db, GTA_ID, "online_access", true);
    await setCounter(db, GTA_ID, "online_rank", 30);
    let r = recommend(await gtaBundle(db), "easiest");
    expect(r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.numeroUno)!.tier).toBe(2);
    await setFlag(db, GTA_ID, "coop_partner", false);
    r = recommend(await gtaBundle(db), "easiest");
    expect(r.blocked.map((b) => b.trophy.trophy.psnTrophyId)).toContain(NAMES.numeroUno);
  });

  it("asks to confirm story trophies the player's progress implies are unlocked, instead of recommending them", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 14); // completed The Jewel Store Job
    const r = recommend(await gtaBundle(db), "best_progress");
    const confirmIds = r.toConfirm.map((c) => c.trophy.trophy.psnTrophyId);
    expect(confirmIds).toEqual(expect.arrayContaining([NAMES.welcome, NAMES.diamondHard]));
    expect(r.ranked.map((x) => x.trophy.trophy.psnTrophyId)).not.toContain(NAMES.welcome);
    // Trophy-chain prerequisites are satisfied by story progress, not by the unverified trophy.
    const friendship = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === 2)!;
    expect(friendship.availability.hard[0].status).toBe("met");
  });

  it("flags a verified-locked story trophy whose mission the player says is done", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 14);
    await setManualStatus(db, tid(NAMES.welcome), "locked");
    const r = recommend(await gtaBundle(db), "easiest");
    const w = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.welcome)!;
    expect(w.cautions.join(" ")).toMatch(/failed to unlock/);
  });

  it("keeps passive trophies out of the main pick", async () => {
    const db = await gtaDb();
    const r = recommend(await gtaBundle(db), "quickest");
    expect(r.passive.map((t) => t.trophy.psnTrophyId)).toContain(NAMES.newPerspective);
    expect(r.ranked.map((x) => x.trophy.trophy.psnTrophyId)).not.toContain(NAMES.newPerspective);
  });
});

describe("missable trophy handling", () => {
  it("warns urgently about Three Man Army once the story reaches The Bureau Raid", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 58);
    const r = recommend(await gtaBundle(db), "easiest");
    const tma = r.urgentMissables.find((m) => m.trophy.trophy.psnTrophyId === NAMES.threeManArmy);
    expect(tma).toBeDefined();
    expect(tma!.warning.sourceUrl).toMatch(/^https:\/\/www\.powerpyx\.com/);
  });

  it("marks Three Man Army as likely lost once the story passes its window", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 69);
    await setEnding(db, GTA_ID, "C");
    const r = recommend(await gtaBundle(db), "easiest");
    expect(r.unobtainable.map((u) => u.trophy.trophy.psnTrophyId)).toContain(NAMES.threeManArmy);
  });

  it("Option A (kill Trevor) makes Trevor-only trophies unobtainable; Option C keeps them", async () => {
    const db = await gtaDb();
    await setEnding(db, GTA_ID, "A");
    let r = recommend(await gtaBundle(db), "easiest");
    const lost = r.unobtainable.map((u) => u.trophy.trophy.psnTrophyId);
    for (const id of [NAMES.redMist, NAMES.tpIndustries, NAMES.wanted, NAMES.altruist]) expect(lost).toContain(id);
    expect(lost).not.toContain(NAMES.kifflom); // Michael-only, Michael survives A
    await setEnding(db, GTA_ID, "C");
    r = recommend(await gtaBundle(db), "easiest");
    expect(r.unobtainable.map((u) => u.trophy.trophy.psnTrophyId)).not.toContain(NAMES.redMist);
  });

  it("asks which ending was chosen when the story may be finished", async () => {
    const db = await gtaDb();
    const r = recommend(await gtaBundle(db), "easiest");
    const redMist = r.ranked.find((x) => x.trophy.trophy.psnTrophyId === NAMES.redMist)!;
    expect(redMist.questions.some((q) => q.kind === "ending")).toBe(true);
  });
});

describe("roadmap", () => {
  it("organises the GTA V Platinum into phases with distinct task states", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 2);
    await setManualStatus(db, tid(NAMES.welcome), "earned");
    const rm = buildRoadmap(await gtaBundle(db));
    const ids = rm.phases.map((p) => p.id);
    expect(ids).toEqual(["story-opening", "missables", "story-completion", "side-activities", "collectibles", "completion-100", "gold-medals", "gta-online", "cleanup"]);
    const states = new Set(rm.phases.flatMap((p) => p.tasks.map((t) => t.state)));
    expect(states).toContain("completed");
    expect(states).toContain("blocked");
    expect(states).toContain("unknown");
    const decision = rm.phases.find((p) => p.id === "story-completion")!.tasks.find((t) => t.kind === "decision")!;
    expect(decision.title).toMatch(/Option C/);
    expect(decision.state).toBe("blocked");
  });

  it("explains blocked tasks", async () => {
    const db = await gtaDb();
    await setStoryIndex(db, GTA_ID, 2);
    const rm = buildRoadmap(await gtaBundle(db));
    const redMist = rm.phases.flatMap((p) => p.tasks).find((t) => t.trophy?.trophy.psnTrophyId === NAMES.redMist)!;
    expect(redMist.state).toBe("blocked");
    expect(redMist.reasons.join(" ")).toMatch(/Trevor Philips Industries/);
  });
});

describe("completion calculations", () => {
  it("counts verified and manual separately and computes PSN-style percentages", async () => {
    const db = await gtaDb();
    await setManualStatus(db, tid(NAMES.welcome), "earned");
    await setManualStatus(db, tid(NAMES.pimp), "earned");
    await setManualStatus(db, tid(NAMES.lsc), "locked");
    const b = await gtaBundle(db);
    const c = computeCompletion(b.trophies);
    expect(c.total).toBe(78);
    expect(c.earned).toBe(2);
    expect(c.manualEarned).toBe(2);
    expect(c.verifiedEarned).toBe(0);
    expect(c.locked).toBe(1);
    expect(c.unknown).toBe(75);
    expect(c.byGrade.bronze).toEqual({ total: 59, earned: 2 });
    expect(c.pointsTotal).toBe(59 * 15 + 15 * 30 + 3 * 90 + 300);
    expect(c.percent).toBe(Math.floor((30 / c.pointsTotal) * 100));
    expect(c.platinum.requiredTotal).toBe(50);
    expect(c.platinum.requiredEarned).toBe(2);
    expect(c.platinum.earned).toBe(false);
  });

  it("returns zeros for an empty list", () => {
    const c = computeCompletion([]);
    expect(c.percent).toBe(0);
    expect(c.platinum.exists).toBe(false);
  });
});
