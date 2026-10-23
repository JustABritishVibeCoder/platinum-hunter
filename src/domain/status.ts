/**
 * Verification-state resolution.
 *
 * Rules (see README "Trophy verification states"):
 *  - VERIFIED_EARNED / VERIFIED_LOCKED only come from the latest successful PSN sync.
 *  - A sync failure never changes a trophy's earned flag: the previous successful
 *    result is kept and surfaced as SYNC_ERROR with its timestamp.
 *  - Manual marks are always labelled MANUAL. A manual "earned" made after the last
 *    successful sync takes precedence for display (the user may have just earned it),
 *    but is never presented as verified.
 *  - No data at all is UNVERIFIED with `earned: null` (unknown, not "locked").
 */
import type { ResolvedStatus, SetSyncState, TrophyStatusRecord } from "./types";

export const DEFAULT_STALE_HOURS = 24;

function after(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a) > Date.parse(b);
}

export function resolveStatus(
  record: TrophyStatusRecord | null | undefined,
  sync: SetSyncState | null | undefined,
  now: Date = new Date(),
  staleHours: number = DEFAULT_STALE_HOURS,
): ResolvedStatus {
  const psnState = record?.psnState ?? null;
  const confirmedAt = record?.psnConfirmedAt ?? null;
  const hasPsn = psnState !== null && confirmedAt !== null;
  const manualState = record?.manualState ?? null;
  const manualAt = record?.manualUpdatedAt ?? null;
  const manualNewer = manualState !== null && after(manualAt, confirmedAt);
  const syncFailedSinceConfirm =
    sync?.status === "error" && !!sync.lastErrorAt && (!confirmedAt || after(sync.lastErrorAt, confirmedAt));
  const stale = hasPsn && now.getTime() - Date.parse(confirmedAt!) > staleHours * 3600_000;

  const base = {
    confirmedAt,
    stale,
    previous: null,
    conflict: false,
    note: null,
  } satisfies Partial<ResolvedStatus>;

  // PSN says earned: earned trophies cannot become unearned, so this always wins.
  if (hasPsn && psnState === "earned") {
    if (syncFailedSinceConfirm) {
      return {
        ...base,
        state: "SYNC_ERROR",
        earned: true,
        earnedAt: record!.psnEarnedAt,
        basis: "psn",
        previous: { state: "earned", confirmedAt },
        note: "The latest sync failed. Showing the last verified result.",
      };
    }
    return {
      ...base,
      state: "VERIFIED_EARNED",
      earned: true,
      earnedAt: record!.psnEarnedAt,
      basis: "psn",
      conflict: manualState === "locked" && manualNewer,
      note: manualState === "locked" && manualNewer ? "You marked this locked, but PSN confirms it is earned." : null,
    };
  }

  // A manual "earned" newer than the last confirmation: show it, labelled MANUAL.
  if (manualState === "earned" && (manualNewer || !hasPsn)) {
    return {
      ...base,
      state: "MANUAL",
      earned: true,
      earnedAt: manualAt,
      basis: "manual",
      conflict: psnState === "locked",
      previous: hasPsn ? { state: psnState, confirmedAt } : null,
      note:
        psnState === "locked"
          ? "Marked earned manually after the last sync. It will be confirmed or corrected by the next successful sync."
          : "Marked earned manually. Not verified by PSN.",
    };
  }

  if (syncFailedSinceConfirm) {
    if (hasPsn) {
      return {
        ...base,
        state: "SYNC_ERROR",
        earned: false,
        earnedAt: null,
        basis: "psn",
        previous: { state: psnState, confirmedAt },
        note: "The latest sync failed. Showing the last verified result.",
      };
    }
    if (manualState === "locked") {
      return { ...base, state: "MANUAL", earned: false, earnedAt: null, basis: "manual", note: "Marked locked manually. Not verified by PSN." };
    }
    return {
      ...base,
      state: "SYNC_ERROR",
      earned: null,
      earnedAt: null,
      basis: "none",
      note: "Sync failed and there is no previous verified result for this trophy.",
    };
  }

  if (hasPsn) {
    // psnState === "locked"
    const conflict = manualState === "earned";
    return {
      ...base,
      state: "VERIFIED_LOCKED",
      earned: false,
      earnedAt: null,
      basis: "psn",
      conflict,
      note: conflict ? "An older manual 'earned' mark was overridden by the latest PSN sync, which reports this trophy as locked." : null,
    };
  }

  if (manualState === "locked") {
    return { ...base, state: "MANUAL", earned: false, earnedAt: null, basis: "manual", note: "Marked locked manually. Not verified by PSN." };
  }

  return { ...base, state: "UNVERIFIED", earned: null, earnedAt: null, basis: "none", note: null };
}

/** True when the trophy's lock state is definitively known (not UNVERIFIED/unknown). */
export function isDefinitelyLocked(s: ResolvedStatus): boolean {
  return s.earned === false;
}

export const STATE_LABEL: Record<ResolvedStatus["state"], string> = {
  VERIFIED_EARNED: "Verified earned",
  VERIFIED_LOCKED: "Verified locked",
  UNVERIFIED: "Unverified",
  SYNC_ERROR: "Sync error",
  MANUAL: "Manual",
};
