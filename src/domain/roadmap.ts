/**
 * Builds the Platinum roadmap from the game's phases and each trophy's live
 * availability. Phases group work; they do not force an order: anything "available"
 * in a later phase can be done now, and overlapping trophies are cross-referenced.
 */
import type { GameBundle, TrophyView } from "./bundle";
import { evaluateAvailability, type AvailabilityResult } from "./availability";
import { buildProgressContext, type ProgressContext, type Question } from "./progress";

export type TaskState = "completed" | "available" | "blocked" | "unknown" | "unobtainable";

export interface RoadmapTask {
  id: string;
  kind: "trophy" | "decision";
  title: string;
  detail: string;
  state: TaskState;
  reasons: string[];
  questions: Question[];
  trophy?: TrophyView;
  availability?: AvailabilityResult;
  urgent: boolean;
}

export interface RoadmapPhaseView {
  id: string;
  name: string;
  description: string;
  tasks: RoadmapTask[];
  completed: number;
  total: number;
  state: "complete" | "in_progress" | "not_started" | "blocked";
}

export interface Roadmap {
  phases: RoadmapPhaseView[];
  context: ProgressContext;
  urgent: RoadmapTask[];
}

function stateFor(av: AvailabilityResult): TaskState {
  switch (av.availability) {
    case "earned":
      return "completed";
    case "available":
      return "available";
    case "blocked":
      return "blocked";
    case "conditional":
      return "unknown";
    case "unobtainable":
      return "unobtainable";
  }
}

export function buildRoadmap(bundle: GameBundle, opts: { includeOptional?: boolean } = {}): Roadmap {
  const ctx = buildProgressContext(bundle);
  const phases = bundle.meta.phases.length
    ? bundle.meta.phases
    : [{ id: "all", name: "All trophies", description: "No curated roadmap for this game yet." }];
  const byPhase = new Map<string, RoadmapTask[]>(phases.map((p) => [p.id, []]));
  const fallbackPhase = phases.find((p) => p.id === "cleanup")?.id ?? phases[phases.length - 1].id;

  for (const tv of bundle.trophies) {
    if (!opts.includeOptional && !tv.requiredForPlatinum) continue;
    const av = evaluateAvailability(tv, ctx, bundle);
    const phaseId = tv.guidance?.phase && byPhase.has(tv.guidance.phase) ? tv.guidance.phase : fallbackPhase;
    const reasons = [...av.reasons];
    if (tv.trophy.grade === "platinum" && tv.status.earned !== true) reasons.push("Unlocks when every other required trophy is earned.");
    byPhase.get(phaseId)!.push({
      id: tv.trophy.id,
      kind: "trophy",
      title: tv.trophy.name,
      detail: tv.guidance?.summary ?? tv.trophy.description,
      state: tv.trophy.grade === "platinum" && tv.status.earned !== true ? "blocked" : stateFor(av),
      reasons,
      questions: av.questions,
      trophy: tv,
      availability: av,
      urgent: av.missable?.level === "urgent",
    });
  }

  // Decision task: the final-mission choice decides which missables survive.
  const endings = bundle.meta.story?.endings;
  const storyPhase = byPhase.get("story-completion");
  if (endings && storyPhase) {
    const safe = endings.options.find((o) => o.removes.length === 0);
    const chosen = endings.options.find((o) => o.id === ctx.ending);
    const nearFinale = ctx.finaleIndex !== null && ctx.storyLower >= Math.max(...[...ctx.checkpointIndex.values()].filter((i) => i < ctx.finaleIndex!), 0);
    const task: RoadmapTask = {
      id: "decision:ending",
      kind: "decision",
      title: `Choose ${safe?.label ?? "the ending that keeps every character"}`,
      detail: "Keep a manual save before the choice. Options that kill a character lock that character's trophies on this save.",
      state: chosen ? (chosen.removes.length ? "unobtainable" : "completed") : nearFinale ? "available" : "blocked",
      reasons: chosen
        ? chosen.removes.length
          ? [`You chose ${chosen.label}. Trophies needing that character require another save.`]
          : []
        : nearFinale
          ? []
          : ["Reach the final mission first."],
      questions: [],
      urgent: !chosen && nearFinale,
    };
    storyPhase.push(task);
  }

  const order: Record<TaskState, number> = { unobtainable: 0, available: 1, unknown: 2, blocked: 3, completed: 4 };
  const views: RoadmapPhaseView[] = phases
    .map((p) => {
      const tasks = (byPhase.get(p.id) ?? []).sort(
        (a, b) => Number(b.urgent) - Number(a.urgent) || order[a.state] - order[b.state] || (a.trophy?.trophy.sortOrder ?? 0) - (b.trophy?.trophy.sortOrder ?? 0),
      );
      const completed = tasks.filter((t) => t.state === "completed").length;
      const actionable = tasks.some((t) => t.state === "available" || t.state === "unknown");
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        tasks,
        completed,
        total: tasks.length,
        state: (tasks.length && completed === tasks.length
          ? "complete"
          : completed > 0
            ? "in_progress"
            : actionable
              ? "not_started"
              : "blocked") as RoadmapPhaseView["state"],
      };
    })
    .filter((p) => p.total > 0);

  return { phases: views, context: ctx, urgent: views.flatMap((p) => p.tasks.filter((t) => t.urgent)) };
}
