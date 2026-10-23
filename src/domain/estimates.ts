/**
 * Turns stored estimates into estimates for THIS player: story trophies depend on how
 * far into the story you are, counter trophies on what is left, rank trophies on RP.
 * Every result carries a plain-language basis so the UI can show where it came from.
 */
import type { GameBundle, TrophyView } from "./bundle";
import type { ProgressContext } from "./progress";

export interface TimeEstimate {
  minutes: number | null;
  basis: string;
  /** True when the number assumes something we could not confirm. */
  assumption: boolean;
}

export interface DifficultyEstimate {
  value: number | null;
  basis: string;
  proxy: boolean;
}

export function rpForRank(rank: number, anchors: { rank: number; rp: number }[]): number {
  const a = [...anchors].sort((x, y) => x.rank - y.rank);
  if (rank <= a[0].rank) return a[0].rp;
  for (let i = 1; i < a.length; i++) {
    if (rank <= a[i].rank) {
      const lo = a[i - 1];
      const hi = a[i];
      return lo.rp + ((hi.rp - lo.rp) * (rank - lo.rank)) / (hi.rank - lo.rank);
    }
  }
  const lo = a[a.length - 2];
  const hi = a[a.length - 1];
  return hi.rp + ((hi.rp - lo.rp) * (rank - hi.rank)) / (hi.rank - lo.rank);
}

export function estimateTime(tv: TrophyView, ctx: ProgressContext, bundle: GameBundle): TimeEstimate {
  const g = tv.guidance;
  if (!g) return { minutes: null, basis: "No estimate available for this trophy", assumption: false };

  const story = bundle.meta.story;
  if (g.storyCheckpoint && story) {
    const target = ctx.checkpointIndex.get(g.storyCheckpoint);
    if (target !== undefined) {
      const known = ctx.storyLower > 0;
      const missions = Math.max(1, target - ctx.storyLower);
      return {
        minutes: missions * story.minutesPerMission,
        basis: known
          ? `About ${missions} mission${missions === 1 ? "" : "s"} from your current story position (~${story.minutesPerMission} min each, approximate order)`
          : `About ${missions} missions from the start of the story (your story position is unknown)`,
        assumption: !known,
      };
    }
  }

  const rank = bundle.meta.rankModel;
  if (g.counter && rank && g.counter.key === rank.counter) {
    const current = ctx.counters[g.counter.key];
    const from = current ?? 1;
    const rp = Math.max(0, rpForRank(g.counter.target, rank.anchors) - rpForRank(from, rank.anchors));
    return {
      minutes: Math.max(10, Math.round((rp / rank.rpPerHour) * 60)),
      basis: `${Math.round(rp).toLocaleString("en-US")} RP to go at ~${rank.rpPerHour.toLocaleString("en-US")} RP/hour (${current === null || current === undefined ? "assuming Rank 1" : `from Rank ${current}`})`,
      assumption: current === null || current === undefined,
    };
  }

  if (g.counter && g.minutes !== null) {
    const current = ctx.counters[g.counter.key];
    if (current !== null && current !== undefined) {
      const remaining = Math.max(0, g.counter.target - current);
      const share = remaining / g.counter.target;
      return {
        minutes: Math.max(5, Math.round(g.minutes * share)),
        basis: `${remaining} of ${g.counter.target} remaining; scaled from the full estimate of ${formatMinutes(g.minutes)}`,
        assumption: false,
      };
    }
    return { minutes: g.minutes, basis: `Full estimate (${g.counter.target} to do; enter your count in Progress to refine)`, assumption: true };
  }

  return {
    minutes: g.minutes,
    basis: g.estimateBasis ?? "Editorial estimate",
    assumption: false,
  };
}

/** Difficulty from guidance, or a clearly-labelled proxy from earn rates. */
export function estimateDifficulty(tv: TrophyView): DifficultyEstimate {
  const g = tv.guidance;
  if (g && g.difficulty !== null) {
    return { value: g.difficulty, basis: `Editorial estimate (${g.confidence} confidence)`, proxy: false };
  }
  const rate = tv.trophy.psnEarnedRate ?? tv.trophy.communityEarnedRate;
  if (rate !== null && rate !== undefined) {
    // Higher earn rate => more players got it => likely easier. Labelled as a proxy.
    const value = Math.min(10, Math.max(1, Math.round(10 - Math.log10(Math.max(rate, 0.1) * 10) * 3.3)));
    const src = tv.trophy.psnEarnedRate !== null ? "PSN earn rate" : "community earn rate";
    return { value, basis: `Proxy from ${src} (${rate}%) - no guide estimate`, proxy: true };
  }
  return { value: null, basis: "Unknown", proxy: true };
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "Unknown";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 10) return `${Math.round(h * 2) / 2} h`;
  return `${Math.round(h)} h`;
}
