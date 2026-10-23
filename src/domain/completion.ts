/** Completion maths. Counts keep verified and manual progress separate. */
import type { TrophyView } from "./bundle";
import type { Grade } from "./types";

/** PSN trophy point values, used for PSN-style progress percentages. */
export const GRADE_POINTS: Record<Grade, number> = { bronze: 15, silver: 30, gold: 90, platinum: 300 };

export interface GradeCount {
  total: number;
  earned: number;
}

export interface Completion {
  total: number;
  earned: number;
  verifiedEarned: number;
  manualEarned: number;
  /** Trophies whose status is genuinely unknown (no PSN data, no manual mark). */
  unknown: number;
  locked: number;
  byGrade: Record<Grade, GradeCount>;
  /** Points-weighted percentage (PSN style), floored like PSN. */
  percent: number;
  pointsEarned: number;
  pointsTotal: number;
  platinum: {
    exists: boolean;
    earned: boolean;
    basis: "psn" | "manual" | "none";
    /** Required trophies (excluding the platinum) earned / total. */
    requiredEarned: number;
    requiredTotal: number;
    percent: number;
  };
}

export function computeCompletion(trophies: TrophyView[]): Completion {
  const byGrade: Record<Grade, GradeCount> = {
    platinum: { total: 0, earned: 0 },
    gold: { total: 0, earned: 0 },
    silver: { total: 0, earned: 0 },
    bronze: { total: 0, earned: 0 },
  };
  let earned = 0;
  let verifiedEarned = 0;
  let manualEarned = 0;
  let unknown = 0;
  let locked = 0;
  let pointsEarned = 0;
  let pointsTotal = 0;
  let requiredEarned = 0;
  let requiredTotal = 0;
  let plat: TrophyView | undefined;

  for (const tv of trophies) {
    const g = tv.trophy.grade;
    byGrade[g].total++;
    pointsTotal += GRADE_POINTS[g];
    if (g === "platinum") plat = tv;
    else if (tv.requiredForPlatinum) requiredTotal++;
    const e = tv.status.earned;
    if (e === true) {
      earned++;
      byGrade[g].earned++;
      pointsEarned += GRADE_POINTS[g];
      if (tv.status.basis === "psn") verifiedEarned++;
      else manualEarned++;
      if (g !== "platinum" && tv.requiredForPlatinum) requiredEarned++;
    } else if (e === false) locked++;
    else unknown++;
  }

  return {
    total: trophies.length,
    earned,
    verifiedEarned,
    manualEarned,
    unknown,
    locked,
    byGrade,
    percent: pointsTotal ? Math.floor((pointsEarned / pointsTotal) * 100) : 0,
    pointsEarned,
    pointsTotal,
    platinum: {
      exists: !!plat,
      earned: plat?.status.earned === true,
      basis: plat?.status.earned === true ? plat.status.basis : "none",
      requiredEarned,
      requiredTotal,
      percent: requiredTotal ? Math.round((requiredEarned / requiredTotal) * 100) : 0,
    },
  };
}
