/**
 * Decides whether a trophy can be worked on right now, using its hard prerequisites,
 * soft prerequisites (timing advice) and missable windows.
 */
import type { GameBundle, TrophyView } from "./bundle";
import { checkpointIdx, evaluatePrereq, type PrereqResult, type ProgressContext, type Question } from "./progress";

export type Availability =
  | "earned"
  | "available" // all hard prerequisites confirmed
  | "conditional" // some prerequisites unknown: needs an answer
  | "blocked" // a prerequisite is known to be incomplete
  | "unobtainable"; // lost on this save (character removed or window passed)

export interface MissableWarning {
  level: "urgent" | "notice" | "lost";
  message: string;
  sourceUrl: string;
}

export interface AvailabilityResult {
  availability: Availability;
  hard: PrereqResult[];
  soft: PrereqResult[];
  /** Human-readable reasons for blocked/unobtainable/conditional. */
  reasons: string[];
  questions: Question[];
  missable: MissableWarning | null;
  /** The player's progress implies this already unlocked; it needs confirming, not playing. */
  likelyEarned: boolean;
}

export function evaluateAvailability(tv: TrophyView, ctx: ProgressContext, bundle: GameBundle): AvailabilityResult {
  const g = tv.guidance;
  const hard = (g?.prereqs ?? []).map((p) => evaluatePrereq(p, ctx, bundle));
  const soft = (g?.softPrereqs ?? []).map((p) => evaluatePrereq(p, ctx, bundle));
  const missable = missableWarning(tv, ctx);

  if (tv.status.earned === true) {
    return { availability: "earned", hard, soft, reasons: [], questions: [], missable: null, likelyEarned: false };
  }

  // Story trophies unlock automatically with their mission. If the story is known to be
  // past that mission and the status is merely unknown, ask for confirmation instead of
  // recommending the player "do" something they have already done.
  const cp = g?.storyCheckpoint ? ctx.checkpointIndex.get(g.storyCheckpoint) : undefined;
  if (cp !== undefined && ctx.storyLower >= cp && tv.status.earned === null) {
    return {
      availability: "conditional",
      hard,
      soft,
      reasons: [`Your story is past ${ctx.checkpointName.get(g!.storyCheckpoint!)}, so this should already be unlocked. Confirm it, or sync with PSN.`],
      questions: [{ kind: "trophy", key: `trophy:${tv.trophy.id}`, text: `Did "${tv.trophy.name}" unlock?`, trophyId: tv.trophy.id }],
      missable: null,
      likelyEarned: true,
    };
  }

  const reasons: string[] = [];
  const lost = hard.filter((h) => h.status === "unmet" && h.prereq.type === "characterAvailable");
  if (lost.length || missable?.level === "lost") {
    for (const l of lost) reasons.push(l.basis);
    if (missable?.level === "lost") reasons.push(missable.message);
    return { availability: "unobtainable", hard, soft, reasons, questions: [], missable, likelyEarned: false };
  }

  const unmet = hard.filter((h) => h.status === "unmet");
  if (unmet.length) {
    for (const u of unmet) reasons.push(`Needs: ${u.label} (${u.basis})`);
    return { availability: "blocked", hard, soft, reasons, questions: [], missable, likelyEarned: false };
  }

  const unknown = hard.filter((h) => h.status === "unknown");
  if (unknown.length) {
    for (const u of unknown) reasons.push(`Unconfirmed: ${u.label}`);
    const questions = dedupeQuestions(unknown.flatMap((u) => (u.question ? [u.question] : [])));
    return { availability: "conditional", hard, soft, reasons, questions, missable, likelyEarned: false };
  }

  if (cp !== undefined && ctx.storyLower >= cp && tv.status.earned === false) {
    reasons.push(
      `${tv.status.basis === "psn" ? "PSN reports" : "You marked"} this locked, although your story is past ${ctx.checkpointName.get(g!.storyCheckpoint!)}. Check whether it failed to unlock; the guide's comments may help.`,
    );
  }
  return { availability: "available", hard, soft, reasons, questions: [], missable, likelyEarned: false };
}

function missableWarning(tv: TrophyView, ctx: ProgressContext): MissableWarning | null {
  const m = tv.guidance?.missable;
  if (!m || tv.status.earned === true) return null;
  const closes = checkpointIdx(ctx, m.closesAfter);
  const warnFrom = checkpointIdx(ctx, m.warnFrom);
  if (closes !== null && ctx.storyLower > closes) {
    return {
      level: "lost",
      message: `The missable window has likely closed (your story is past ${ctx.checkpointName.get(m.closesAfter!)}). You may need an earlier save.`,
      sourceUrl: m.sourceUrl,
    };
  }
  // Without an explicit window, warn as the finale approaches (the last checkpoint before it).
  const approach =
    warnFrom ??
    (ctx.finaleIndex !== null
      ? Math.max(...[...ctx.checkpointIndex.values()].filter((i) => i < ctx.finaleIndex!), 0)
      : null);
  if (approach !== null && ctx.storyLower >= approach) {
    return { level: "urgent", message: m.note, sourceUrl: m.sourceUrl };
  }
  return { level: "notice", message: m.note, sourceUrl: m.sourceUrl };
}

export function dedupeQuestions(qs: Question[]): Question[] {
  const seen = new Set<string>();
  return qs.filter((q) => (seen.has(q.key) ? false : (seen.add(q.key), true)));
}
