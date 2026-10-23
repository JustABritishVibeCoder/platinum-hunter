/**
 * The "next trophy" recommendation engine.
 *
 * Pipeline:
 *  1. Candidates = unearned trophies that count towards the Platinum (optionally add-ons),
 *     excluding the Platinum itself.
 *  2. Each candidate is classified with `evaluateAvailability` (available / conditional /
 *     blocked / unobtainable). Blocked and unobtainable trophies are never recommended.
 *  3. Candidates are ranked by tier, then by the mode's key:
 *       tier 0: available, timing advice satisfied
 *       tier 1: available, but a soft prerequisite says "better later"
 *       tier 2: conditional (an unanswered question)
 *       tier 3: skipped by the user (temporarily deprioritised, never removed)
 *     EASIEST  -> lowest difficulty, then time
 *     QUICKEST -> lowest time, then difficulty
 *     BEST PROGRESS -> highest (1 + trophies it unlocks + missable urgency) per hour,
 *                     penalised for unconfirmed co-op requirements
 *  4. Every recommendation carries readable reasons, cautions, questions and the
 *     provenance of the data it used, never a bare score.
 */
import type { GameBundle, TrophyView } from "./bundle";
import { dedupeQuestions, evaluateAvailability, type AvailabilityResult, type MissableWarning } from "./availability";
import { estimateDifficulty, estimateTime, formatMinutes, type DifficultyEstimate, type TimeEstimate } from "./estimates";
import { buildProgressContext, type ProgressContext, type Question } from "./progress";
import type { Prereq, RecommendationMode } from "./types";

export interface InfoProvenance {
  unlockStatus: string;
  estimates: string;
  prerequisites: string;
}

export interface Recommendation {
  trophy: TrophyView;
  mode: RecommendationMode;
  rank: number;
  tier: 0 | 1 | 2 | 3;
  availability: AvailabilityResult;
  time: TimeEstimate;
  difficulty: DifficultyEstimate;
  unlocks: TrophyView[];
  reasons: string[];
  cautions: string[];
  questions: Question[];
  provenance: InfoProvenance;
  skippedUntil: string | null;
  /** Internal ordering value (exposed for tests and debugging only). */
  sortValue: number;
}

export interface RecommendationResult {
  mode: RecommendationMode;
  ranked: Recommendation[];
  blocked: { trophy: TrophyView; availability: AvailabilityResult }[];
  unobtainable: { trophy: TrophyView; availability: AvailabilityResult }[];
  passive: TrophyView[];
  /** Trophies the player's progress implies are already unlocked: confirm, don't play. */
  toConfirm: { trophy: TrophyView; availability: AvailabilityResult }[];
  urgentMissables: { trophy: TrophyView; warning: MissableWarning }[];
  questions: Question[];
  remainingRequired: number;
  context: ProgressContext;
}

export interface RecommendOptions {
  now?: Date;
  includeOptional?: boolean;
}

const MODE_LABEL: Record<RecommendationMode, string> = {
  easiest: "Easiest",
  quickest: "Quickest",
  best_progress: "Best progress",
};
export { MODE_LABEL };

function prereqReferences(p: Prereq, target: TrophyView, ctx: ProgressContext): boolean {
  if (p.type === "trophy") return p.psnTrophyId === target.trophy.psnTrophyId;
  if (p.type === "story" && target.guidance?.storyCheckpoint) {
    // Completing a story trophy also completes its checkpoint, unblocking later work.
    const a = ctx.checkpointIndex.get(p.checkpoint);
    const b = ctx.checkpointIndex.get(target.guidance.storyCheckpoint);
    return a !== undefined && b !== undefined && a <= b && a > ctx.storyLower;
  }
  return false;
}

/** Unearned trophies that are currently blocked and would be helped by earning `tv`. */
function unlocksFor(tv: TrophyView, all: TrophyView[], blockedIds: Set<string>, ctx: ProgressContext): TrophyView[] {
  return all.filter(
    (o) =>
      o.trophy.id !== tv.trophy.id &&
      blockedIds.has(o.trophy.id) &&
      (o.guidance?.prereqs ?? []).some((p) => prereqReferences(p, tv, ctx)),
  );
}

function provenance(tv: TrophyView, av: AvailabilityResult, bundle: GameBundle): InfoProvenance {
  const s = tv.status;
  const unlockStatus =
    s.state === "VERIFIED_LOCKED"
      ? `PSN-verified locked${s.stale ? " (stale - sync recommended)" : ""}`
      : s.state === "SYNC_ERROR"
        ? `Last sync failed; using the previous verified result${s.confirmedAt ? ` from ${new Date(s.confirmedAt).toLocaleString()}` : ""}`
        : s.state === "MANUAL"
          ? "Manually tracked - not verified by PSN"
          : "Unverified - no PSN data for this trophy yet";
  const g = tv.guidance;
  const est = bundle.meta.estimates;
  const estimates = g
    ? `${est?.source ?? "Estimate"}${est?.date ? ` (${est.date})` : ""}, ${g.confidence} confidence`
    : tv.trophy.psnEarnedRate !== null
      ? "No guide data; difficulty is a proxy from the PSN earn rate"
      : "No guide data available";
  const all = [...av.hard];
  const prerequisites =
    all.length === 0
      ? "No known prerequisites"
      : all.map((h) => `${h.label}: ${h.status === "met" ? "confirmed" : h.status === "unmet" ? "not yet" : "unconfirmed"} (${h.basis})`).join("; ");
  return { unlockStatus, estimates, prerequisites };
}

export function recommend(bundle: GameBundle, mode: RecommendationMode, opts: RecommendOptions = {}): RecommendationResult {
  const now = opts.now ?? new Date();
  const ctx = buildProgressContext(bundle);
  const inScope = bundle.trophies.filter(
    (t) => t.trophy.grade !== "platinum" && (opts.includeOptional || t.requiredForPlatinum),
  );

  const evaluated = inScope.map((tv) => ({ tv, av: evaluateAvailability(tv, ctx, bundle) }));
  const blockedIds = new Set(evaluated.filter((e) => e.av.availability === "blocked").map((e) => e.tv.trophy.id));

  const blocked: RecommendationResult["blocked"] = [];
  const unobtainable: RecommendationResult["unobtainable"] = [];
  const passive: TrophyView[] = [];
  const toConfirm: RecommendationResult["toConfirm"] = [];
  const urgentMissables: RecommendationResult["urgentMissables"] = [];
  const candidates: Recommendation[] = [];
  let remainingRequired = 0;

  for (const { tv, av } of evaluated) {
    if (av.availability === "earned") continue;
    if (tv.requiredForPlatinum) remainingRequired++;
    if (av.missable && av.missable.level === "urgent" && av.availability !== "unobtainable") {
      urgentMissables.push({ trophy: tv, warning: av.missable });
    }
    if (av.availability === "blocked") {
      blocked.push({ trophy: tv, availability: av });
      continue;
    }
    if (av.availability === "unobtainable") {
      unobtainable.push({ trophy: tv, availability: av });
      continue;
    }
    if (av.likelyEarned) {
      toConfirm.push({ trophy: tv, availability: av });
      continue;
    }
    if (tv.guidance?.passive) {
      passive.push(tv);
      continue;
    }

    const time = estimateTime(tv, ctx, bundle);
    const difficulty = estimateDifficulty(tv);
    const unlocks = unlocksFor(tv, inScope, blockedIds, ctx);
    const skipUntil = bundle.skips[tv.trophy.id];
    const skipped = !!skipUntil && Date.parse(skipUntil) > now.getTime();
    const softUnmet = av.soft.filter((s) => s.status !== "met");
    const tier: Recommendation["tier"] = skipped ? 3 : av.availability === "conditional" ? 2 : softUnmet.length ? 1 : 0;

    const minutes = time.minutes ?? 240;
    const diff = difficulty.value ?? 6;
    const hours = Math.max(0.25, minutes / 60);
    const urgency = av.missable?.level === "urgent" ? 3 : 0;
    const coopUnconfirmed = tv.guidance?.multiplayer === "required" && ctx.flags["coop_partner"] !== true;
    let sortValue: number;
    if (mode === "easiest") sortValue = diff * 10_000 + minutes;
    else if (mode === "quickest") sortValue = minutes * 100 + diff;
    else {
      const value = (1 + unlocks.length + urgency) / hours;
      sortValue = -(value * (coopUnconfirmed ? 0.5 : 1));
    }

    const cautions: string[] = [];
    if (av.missable) cautions.push(`Missable: ${av.missable.message}`);
    for (const s of softUnmet) cautions.push(`Better after: ${s.label} (${s.basis})`);
    if (tv.guidance?.multiplayer === "required") cautions.push("Needs other real players.");
    if (tv.guidance?.onlineRequired) cautions.push("Requires GTA Online / online play.");
    if (time.assumption) cautions.push(`Time estimate assumes: ${time.basis}`);
    if (difficulty.proxy) cautions.push(`Difficulty is a ${difficulty.basis.toLowerCase()}.`);
    if (tv.status.state === "SYNC_ERROR") cautions.push("Latest PSN sync failed; status may be out of date.");
    if (tv.status.stale) cautions.push("PSN data is stale; sync to confirm this trophy is still locked.");
    if (av.availability === "available") for (const reason of av.reasons) cautions.push(reason);

    candidates.push({
      trophy: tv,
      mode,
      rank: 0,
      tier,
      availability: av,
      time,
      difficulty,
      unlocks,
      reasons: [],
      cautions,
      questions: av.questions,
      provenance: provenance(tv, av, bundle),
      skippedUntil: skipped ? skipUntil : null,
      sortValue,
    });
  }

  candidates.sort((a, b) => a.tier - b.tier || a.sortValue - b.sortValue || a.trophy.trophy.sortOrder - b.trophy.trophy.sortOrder);
  const availableCount = candidates.filter((c) => c.tier <= 1).length;
  candidates.forEach((c, i) => {
    c.rank = i + 1;
    c.reasons = explain(c, i, candidates, availableCount, mode, ctx);
  });

  return {
    mode,
    ranked: candidates,
    blocked,
    unobtainable,
    passive,
    toConfirm,
    urgentMissables,
    questions: dedupeQuestions(candidates.filter((c) => c.tier === 2).flatMap((c) => c.questions)),
    remainingRequired,
    context: ctx,
  };
}

function explain(
  c: Recommendation,
  index: number,
  all: Recommendation[],
  availableCount: number,
  mode: RecommendationMode,
  ctx: ProgressContext,
): string[] {
  const r: string[] = [];
  const g = c.trophy.guidance;
  const peers = all.filter((x) => x.tier === c.tier);
  if (c.tier <= 1) {
    if (mode === "easiest") {
      r.push(
        index === 0
          ? `Lowest estimated difficulty (${c.difficulty.value ?? "?"}/10) of the ${availableCount} trophies you can work on now.`
          : `Difficulty ${c.difficulty.value ?? "?"}/10, ranked #${c.rank} for ease.`,
      );
    } else if (mode === "quickest") {
      r.push(
        index === 0
          ? `Shortest estimated time (${formatMinutes(c.time.minutes)}) of the ${availableCount} trophies you can work on now.`
          : `About ${formatMinutes(c.time.minutes)}, ranked #${c.rank} for speed.`,
      );
    } else {
      r.push(`Best Platinum progress per hour among ${peers.length} similar options (about ${formatMinutes(c.time.minutes)}).`);
    }
    r.push(c.availability.hard.length ? "All of its prerequisites are confirmed." : "It has no known prerequisites.");
  } else if (c.tier === 2) {
    r.push("Looks achievable, but some prerequisites are unconfirmed. Answer the question below to confirm.");
  } else {
    r.push(`You skipped this until ${new Date(c.skippedUntil!).toLocaleString()}. It stays on your list.`);
  }
  if (g?.storyCheckpoint) {
    r.push(
      ctx.storyLower > 0
        ? "Progresses the main story, which unlocks further trophies."
        : "Story trophy. Set your story progress to sharpen this estimate.",
    );
  }
  if (c.unlocks.length) {
    const names = c.unlocks.slice(0, 3).map((u) => u.trophy.name).join(", ");
    r.push(`Unblocks ${c.unlocks.length} other trophy${c.unlocks.length === 1 ? "" : "ies"}: ${names}${c.unlocks.length > 3 ? "..." : ""}.`);
  }
  if (c.availability.missable?.level === "urgent") r.push("Missable and its window is approaching: do it before progressing further.");
  if (g && g.multiplayer === "none" && !g.onlineRequired) r.push("Can be done solo, offline.");
  const related = (g?.relatedPsnIds ?? [])
    .map((id) => ctx.trophyByPsnId.get(id))
    .filter((t): t is TrophyView => !!t && t.status.earned !== true);
  if (related.length) r.push(`Overlaps with: ${related.slice(0, 3).map((t) => t.trophy.name).join(", ")}.`);
  return r;
}
