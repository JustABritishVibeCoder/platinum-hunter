/**
 * Builds what we know about the player's progress from two sources, kept distinct:
 *  - evidence from trophy statuses (e.g. "Diamond Hard" earned => story is past
 *    The Jewel Store Job; a verified-locked story trophy => story is NOT past it), and
 *  - answers the user gave (always manual).
 * Then evaluates prerequisites against it as met / unmet / unknown.
 */
import type { GameBundle, TrophyView } from "./bundle";
import type { Character, Prereq } from "./types";

export interface Question {
  kind: "story" | "flag" | "counter" | "ending" | "trophy";
  /** Stable key so the UI can de-duplicate questions. */
  key: string;
  text: string;
  help?: string;
  /** For story questions: the checkpoint asked about. */
  checkpointId?: string;
  flagId?: string;
  counterKey?: string;
  trophyId?: string;
}

export interface ProgressContext {
  /** Highest story checkpoint index known to be completed (0 = nothing known). */
  storyLower: number;
  /** Highest index that could have been reached (Infinity = no upper bound known). */
  storyUpper: number;
  storyLowerBasis: string | null;
  storyKnown: boolean;
  ending: "A" | "B" | "C" | "not_reached" | null;
  removedCharacters: Set<Character>;
  flags: Record<string, boolean | null>;
  counters: Record<string, number | null>;
  counterBasis: Record<string, string>;
  trophyById: Map<string, TrophyView>;
  trophyByPsnId: Map<number, TrophyView>;
  checkpointIndex: Map<string, number>;
  checkpointName: Map<string, string>;
  finaleIndex: number | null;
}

export type PrereqStatus = "met" | "unmet" | "unknown";

export interface PrereqResult {
  prereq: Prereq;
  status: PrereqStatus;
  label: string;
  /** Why we believe the status: evidence or the user's answer. */
  basis: string;
  question?: Question;
}

export function buildProgressContext(bundle: GameBundle): ProgressContext {
  const checkpoints = bundle.meta.story?.checkpoints ?? [];
  const checkpointIndex = new Map(checkpoints.map((c) => [c.id, c.index]));
  const checkpointName = new Map(checkpoints.map((c) => [c.id, c.name]));
  const sorted = [...checkpoints].sort((a, b) => a.index - b.index);
  const finaleIndex = sorted.length ? sorted[sorted.length - 1].index : null;

  let storyLower = 0;
  let storyLowerBasis: string | null = null;
  let storyUpper = Number.POSITIVE_INFINITY;

  const trophyById = new Map(bundle.trophies.map((t) => [t.trophy.id, t]));
  const trophyByPsnId = new Map(bundle.trophies.map((t) => [t.trophy.psnTrophyId, t]));

  for (const tv of bundle.trophies) {
    const g = tv.guidance;
    if (!g) continue;
    if (tv.status.earned === true) {
      // An earned trophy proves its story checkpoint and all hard story prereqs were reached.
      const proven = [g.storyCheckpoint, ...g.prereqs.filter((p) => p.type === "story").map((p) => (p as { checkpoint: string }).checkpoint)];
      for (const cp of proven) {
        const idx = cp ? checkpointIndex.get(cp) : undefined;
        if (idx !== undefined && idx > storyLower) {
          storyLower = idx;
          storyLowerBasis = `${tv.status.basis === "psn" ? "PSN-verified" : "manually marked"} trophy "${tv.trophy.name}"`;
        }
      }
    } else if (tv.status.earned === false && g.storyCheckpoint) {
      // A definitively locked story trophy means that checkpoint has not been completed.
      const idx = checkpointIndex.get(g.storyCheckpoint);
      if (idx !== undefined) storyUpper = Math.min(storyUpper, idx - 1);
    }
  }

  const p = bundle.progress;
  if (p.ending === "A" || p.ending === "B" || p.ending === "C") {
    if (finaleIndex !== null && finaleIndex > storyLower) {
      storyLower = finaleIndex;
      storyLowerBasis = "your answer about the final mission";
    }
  }
  if (p.storyIndex !== null) {
    if (p.storyIndex > storyLower) {
      storyLower = p.storyIndex;
      storyLowerBasis = "your story progress (manual)";
    }
    const next = sorted.find((c) => c.index > p.storyIndex!);
    if (next) storyUpper = Math.min(storyUpper, Math.max(next.index - 1, storyLower));
  }
  if (storyUpper < storyLower) storyUpper = storyLower; // trophies outrank stale answers

  const removed = new Set<Character>();
  const endingOption = bundle.meta.story?.endings?.options.find((o) => o.id === p.ending);
  for (const c of endingOption?.removes ?? []) removed.add(c);

  // Counters: user answers, raised by evidence from earned counter trophies.
  const counters: Record<string, number | null> = {};
  const counterBasis: Record<string, string> = {};
  for (const c of bundle.meta.counters) {
    const v = p.counters[c.key];
    counters[c.key] = v ?? null;
    if (v !== null && v !== undefined) counterBasis[c.key] = "your answer (manual)";
  }
  for (const tv of bundle.trophies) {
    const ctr = tv.guidance?.counter;
    if (ctr && tv.status.earned === true) {
      const cur = counters[ctr.key];
      if (cur === null || cur === undefined || cur < ctr.target) {
        counters[ctr.key] = ctr.target;
        counterBasis[ctr.key] = `implied by earned trophy "${tv.trophy.name}"`;
      }
    }
  }

  return {
    storyLower,
    storyUpper,
    storyLowerBasis,
    storyKnown: storyLower > 0 || storyUpper !== Number.POSITIVE_INFINITY,
    ending: p.ending,
    removedCharacters: removed,
    flags: { ...p.flags },
    counters,
    counterBasis,
    trophyById,
    trophyByPsnId,
    checkpointIndex,
    checkpointName,
    finaleIndex,
  };
}

const CHARACTER_NAME: Record<Character, string> = { michael: "Michael", franklin: "Franklin", trevor: "Trevor" };

export function evaluatePrereq(p: Prereq, ctx: ProgressContext, bundle: GameBundle): PrereqResult {
  switch (p.type) {
    case "story": {
      const idx = ctx.checkpointIndex.get(p.checkpoint);
      const name = ctx.checkpointName.get(p.checkpoint) ?? p.checkpoint;
      const label = `Story: ${name} completed`;
      if (idx === undefined) return { prereq: p, status: "unknown", label, basis: "Unknown checkpoint" };
      if (ctx.storyLower >= idx) return { prereq: p, status: "met", label, basis: `Confirmed by ${ctx.storyLowerBasis ?? "your progress"}` };
      if (ctx.storyUpper < idx) return { prereq: p, status: "unmet", label, basis: "Your story has not reached this mission yet" };
      return {
        prereq: p,
        status: "unknown",
        label,
        basis: "No trophy or answer confirms this yet",
        question: { kind: "story", key: `story:${p.checkpoint}`, text: `Have you completed the story mission "${name}"?`, checkpointId: p.checkpoint },
      };
    }
    case "trophy": {
      const tv = ctx.trophyByPsnId.get(p.psnTrophyId);
      const label = `Trophy: ${tv?.trophy.name ?? `#${p.psnTrophyId}`}`;
      if (!tv) return { prereq: p, status: "unknown", label, basis: "Trophy not in this list" };
      if (tv.status.earned === true) return { prereq: p, status: "met", label, basis: tv.status.basis === "psn" ? "PSN-verified earned" : "Marked earned manually" };
      // For story-chain dependencies, what matters is that the mission was played.
      const cpIdx = tv.guidance?.storyCheckpoint ? ctx.checkpointIndex.get(tv.guidance.storyCheckpoint) : undefined;
      if (cpIdx !== undefined && ctx.storyLower >= cpIdx) {
        return { prereq: p, status: "met", label, basis: `Your story is past ${ctx.checkpointName.get(tv.guidance!.storyCheckpoint!)} (${ctx.storyLowerBasis ?? "your progress"})` };
      }
      if (tv.status.earned === false) return { prereq: p, status: "unmet", label, basis: tv.status.basis === "psn" ? "PSN reports it locked" : "Marked locked manually" };
      return {
        prereq: p,
        status: "unknown",
        label,
        basis: "Status unverified",
        question: { kind: "trophy", key: `trophy:${tv.trophy.id}`, text: `Have you already earned "${tv.trophy.name}"?`, trophyId: tv.trophy.id },
      };
    }
    case "flag": {
      const f = bundle.meta.flags.find((x) => x.id === p.flag);
      const value = ctx.flags[p.flag];
      const label = f?.question.replace(/\?$/, "") ?? p.flag;
      if (value === true) return { prereq: p, status: "met", label, basis: "Your answer (manual)" };
      if (value === false) return { prereq: p, status: "unmet", label, basis: "Your answer (manual)" };
      return {
        prereq: p,
        status: "unknown",
        label,
        basis: "Not answered yet",
        question: { kind: "flag", key: `flag:${p.flag}`, text: f?.question ?? p.flag, help: f?.help, flagId: p.flag },
      };
    }
    case "counterAtLeast": {
      const c = bundle.meta.counters.find((x) => x.key === p.counter);
      const value = ctx.counters[p.counter];
      const label = `${c?.label ?? p.counter} at least ${p.value}`;
      if (value !== null && value !== undefined) {
        return value >= p.value
          ? { prereq: p, status: "met", label, basis: ctx.counterBasis[p.counter] ?? "Your answer" }
          : { prereq: p, status: "unmet", label, basis: `Currently ${value} (${ctx.counterBasis[p.counter] ?? "your answer"})` };
      }
      return {
        prereq: p,
        status: "unknown",
        label,
        basis: "Not answered yet",
        question: { kind: "counter", key: `counter:${p.counter}`, text: `What is your current ${c?.label ?? p.counter}?`, counterKey: p.counter },
      };
    }
    case "characterAvailable": {
      const label = `${CHARACTER_NAME[p.character]} still playable`;
      if (ctx.removedCharacters.has(p.character)) {
        return { prereq: p, status: "unmet", label, basis: `${CHARACTER_NAME[p.character]} was removed by your final-mission choice` };
      }
      const endings = bundle.meta.story?.endings;
      if (!endings || ctx.ending === "C" || ctx.ending === "not_reached") {
        return { prereq: p, status: "met", label, basis: ctx.ending === "C" ? "You chose Option C" : "No ending choice affects this" };
      }
      if (ctx.finaleIndex !== null && ctx.storyUpper < ctx.finaleIndex) {
        return { prereq: p, status: "met", label, basis: "Your story has not reached the final mission yet" };
      }
      return {
        prereq: p,
        status: "unknown",
        label,
        basis: "Final mission choice unknown",
        question: { kind: "ending", key: "ending", text: endings.question },
      };
    }
  }
}

/** Story index of a checkpoint id, or null. */
export function checkpointIdx(ctx: ProgressContext, id: string | undefined | null): number | null {
  if (!id) return null;
  return ctx.checkpointIndex.get(id) ?? null;
}
