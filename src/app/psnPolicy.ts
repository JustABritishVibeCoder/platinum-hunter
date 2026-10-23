/**
 * Rules that keep PSN usage minimal after a user's account was locked:
 *  - PSN is opt-in (off by default); the Rust backend refuses all requests while off.
 *  - At most one sync per hour (launch, Sync now, Sync all, session end). The first sync
 *    right after linking a game is the only exception.
 *  - The profile refreshes at most once a day.
 *  - Rust additionally caps PSN requests at 20 per rolling hour.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/tauriDriver";
import { selectOne } from "../db/driver";
import { getServices } from "./services";
import { useApp } from "./store";
import { useNow, useQuery } from "./useQuery";

export const SYNC_COOLDOWN_MS = 60 * 60_000;
export const PROFILE_REFRESH_MS = 24 * 60 * 60_000;

export async function lastSyncAttempt(): Promise<string | null> {
  const r = await selectOne<{ t: string | null }>(getServices().db, "SELECT MAX(last_attempt_at) AS t FROM sync_state");
  return r?.t ?? null;
}

export function cooldownRemainingMs(lastAttempt: string | null, now: Date = new Date()): number {
  if (!lastAttempt) return 0;
  return Math.max(0, Date.parse(lastAttempt) + SYNC_COOLDOWN_MS - now.getTime());
}

export function formatCooldown(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? "1 h" : `${m} min`;
}

export function usePsnEnabled(): boolean {
  return useApp((s) => s.settings.psn.optIn);
}

/** Live cooldown state for sync buttons. */
export function useSyncCooldown(): { ready: boolean; remainingMs: number; label: string } {
  const q = useQuery(lastSyncAttempt, []);
  const now = useNow();
  const remainingMs = cooldownRemainingMs(q.data ?? null, now);
  return { ready: remainingMs === 0, remainingMs, label: remainingMs ? `Next sync in ${formatCooldown(remainingMs)}` : "Sync now" };
}

/** Tells the Rust backend whether PSN requests are allowed. */
export async function applyPsnOptIn(on: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("psn_set_enabled", { enabled: on });
}
