/**
 * Links a local trophy set to the exact PSN trophy list.
 *
 * The PS4 and PS5 versions of a game have separate trophy lists with identical names
 * (and, for GTA V, identical trophy counts), so the title name alone is never enough.
 * A candidate must match the set's platform AND trophy service (`trophy2` = PS5).
 */
import type { NpServiceName, Platform } from "../domain/types";
import type { PsnTrophyTitle } from "./schemas";

export interface BindingTarget {
  title: string;
  platform: Platform;
  npServiceName: NpServiceName | null;
  expectedCounts?: { platinum: number; gold: number; silver: number; bronze: number } | null;
}

export interface BindingCandidate {
  title: PsnTrophyTitle;
  accepted: boolean;
  confidence: "exact" | "likely" | "rejected";
  reasons: string[];
}

export function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\b(ps4|ps5|playstation ?[45])\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function platformsOf(t: PsnTrophyTitle): string[] {
  return t.trophyTitlePlatform.split(",").map((p) => p.trim().toUpperCase());
}

export function serviceFor(platform: Platform): NpServiceName {
  return platform === "PS5" ? "trophy2" : "trophy";
}

export function evaluateCandidates(target: BindingTarget, titles: PsnTrophyTitle[]): BindingCandidate[] {
  const wantName = normaliseTitle(target.title);
  const wantService = target.npServiceName ?? serviceFor(target.platform);
  const out: BindingCandidate[] = [];
  for (const t of titles) {
    const name = normaliseTitle(t.trophyTitleName);
    const nameMatch = name === wantName ? "exact" : name.includes(wantName) || wantName.includes(name) ? "partial" : "none";
    if (nameMatch === "none") continue;
    const reasons: string[] = [];
    let accepted = true;
    if (!platformsOf(t).includes(target.platform)) {
      accepted = false;
      reasons.push(`This is the ${t.trophyTitlePlatform} trophy list, not ${target.platform}.`);
    }
    if (t.npServiceName !== wantService) {
      accepted = false;
      reasons.push(`Trophy service is "${t.npServiceName}" but ${target.platform} lists use "${wantService}".`);
    }
    // A count mismatch is a warning, not a rejection: platform + service are what keep
    // PS4 and PS5 apart, and PSN may count add-on groups differently from the dataset.
    let countsMatch = true;
    if (target.expectedCounts) {
      const d = t.definedTrophies;
      const e = target.expectedCounts;
      if (d.platinum !== e.platinum || d.gold !== e.gold || d.silver !== e.silver || d.bronze !== e.bronze) {
        countsMatch = false;
        reasons.push(
          `Warning: defines ${d.platinum}P/${d.gold}G/${d.silver}S/${d.bronze}B; the dataset expects ${e.platinum}P/${e.gold}G/${e.silver}S/${e.bronze}B. PSN's list will replace the dataset on sync.`,
        );
      }
    }
    if (accepted) reasons.push(`Matches ${target.platform} (${wantService}) ${nameMatch === "exact" ? "with an exact title match" : "with a similar title"}.`);
    out.push({
      title: t,
      accepted,
      confidence: !accepted ? "rejected" : nameMatch === "exact" && countsMatch ? "exact" : "likely",
      reasons,
    });
  }
  return out.sort((a, b) => Number(b.accepted) - Number(a.accepted) || (a.confidence === "exact" ? -1 : 1));
}

/** Returns the single safe automatic match, or null if user confirmation is needed. */
export function autoBind(target: BindingTarget, titles: PsnTrophyTitle[]): PsnTrophyTitle | null {
  const accepted = evaluateCandidates(target, titles).filter((c) => c.confidence === "exact");
  return accepted.length === 1 ? accepted[0].title : null;
}

export function platformFromPsn(t: PsnTrophyTitle): Platform {
  const ps = platformsOf(t);
  for (const p of ["PS5", "PS4", "PS3", "PSVITA", "PSVR2", "PSVR"] as Platform[]) if (ps.includes(p)) return p;
  return t.npServiceName === "trophy2" ? "PS5" : "PS4";
}
