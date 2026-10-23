/**
 * User actions. Each one performs a real write, then invalidates queries. Success
 * messages are only shown after the operation has actually completed.
 */
import { errorMessage } from "../db/driver";
import { setCounter, setEnding, setFlag, setStoryIndex } from "../db/repo/progress";
import * as sessions from "../db/repo/sessions";
import { saveSettings, type Settings } from "../db/repo/settings";
import { setManualStatus } from "../db/repo/status";
import { isTauri } from "../db/tauriDriver";
import type { Question } from "../domain/progress";
import { clearProfile, loadProfile, parseProfile, saveProfile } from "../psn/profile";
import { syncAllBound, syncSet, type SyncResult } from "../psn/sync";
import { applyPsnOptIn, cooldownRemainingMs, formatCooldown, lastSyncAttempt, PROFILE_REFRESH_MS } from "./psnPolicy";
import { getServices } from "./services";
import { useApp } from "./store";

const app = () => useApp.getState();

async function run<T>(fn: () => Promise<T>, failTitle: string): Promise<T | undefined> {
  try {
    const r = await fn();
    app().invalidate();
    return r;
  } catch (e) {
    app().toast({ kind: "error", title: failTitle, body: errorMessage(e) });
    app().invalidate();
    return undefined;
  }
}

export function applyAppearance(s: Pick<Settings, "theme" | "accent">) {
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.accent = s.accent;
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = await run(() => saveSettings(getServices().db, patch), "Could not save settings");
  if (next) {
    app().setSettingsState(next);
    applyAppearance(next);
  }
  return next;
}

async function notify(title: string, body: string) {
  if (!isTauri()) return;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (granted) n.sendNotification({ title, body });
  } catch {
    /* notifications are best-effort */
  }
}

export async function markManual(trophyId: string, state: "earned" | "locked" | null, trophyName?: string, opts: { quiet?: boolean } = {}) {
  const open = await sessions.getOpenSession(getServices().db).catch(() => null);
  const ok = await run(() => setManualStatus(getServices().db, trophyId, state, { sessionId: open?.status === "active" ? open.id : null }), "Could not update trophy");
  if (ok !== undefined && !opts.quiet) {
    app().toast({
      kind: "info",
      title: state === "earned" ? `Marked "${trophyName ?? "trophy"}" earned (manual)` : state === "locked" ? "Marked locked (manual)" : "Manual mark cleared",
      body: state ? "Manual marks are labelled MANUAL and are not PSN-verified." : undefined,
    });
  }
}

/** Shows the cached profile immediately; refreshes from PSN at most once a day (or when forced). */
export async function refreshProfile(opts: { fetch?: boolean; force?: boolean } = { fetch: true }) {
  const { db, psn } = getServices();
  const cached = await loadProfile(db).catch(() => null);
  if (cached) app().setProfile(cached);
  if (!opts.fetch || !app().psn?.connected || !app().settings.psn.optIn) return;
  if (!opts.force && cached && Date.now() - Date.parse(cached.fetchedAt) < PROFILE_REFRESH_MS) return;
  try {
    const p = parseProfile(await psn.ownProfile());
    await saveProfile(db, p);
    app().setProfile(p);
    app().setProfileError(null);
  } catch (e) {
    // Keep any cached profile, but say why it couldn't be refreshed.
    app().setProfileError(errorMessage(e));
  }
}

export async function forgetProfile() {
  await clearProfile(getServices().db).catch(() => undefined);
  app().setProfile(null);
}

/** Turns the PSN opt-in on or off. Turning it off also removes the stored sign-in. */
export async function setPsnOptIn(on: boolean) {
  const { psn } = getServices();
  if (!on) {
    await psn.disconnect().catch(() => undefined);
    await forgetProfile();
  }
  await applyPsnOptIn(on);
  await updateSettings({ psn: { optIn: on, riskAcknowledgedAt: on ? new Date().toISOString() : app().settings.psn.riskAcknowledgedAt } });
  await refreshPsnStatus();
}

export async function refreshPsnStatus() {
  try {
    app().setPsn(await getServices().psn.status());
  } catch {
    app().setPsn(null);
  }
}

function reportSync(results: SyncResult[], names: Record<string, string> = {}) {
  const s = app().settings;
  for (const r of results) {
    const name = names[r.setId] ?? "Game";
    if (r.ok) {
      app().toast({ kind: "success", title: `${name}: sync complete`, body: r.message });
      if (r.newlyEarned.length && s.notifications.trophyEarned) {
        void notify("Trophy confirmed by PSN", r.newlyEarned.slice(0, 3).join(", ") + (r.newlyEarned.length > 3 ? "..." : ""));
      }
    } else {
      app().toast({
        kind: "error",
        title: `${name}: sync failed`,
        body: `${r.message}${r.retryAfterSecs ? ` Retry in ${r.retryAfterSecs}s.` : ""} Previous verified data was kept.`,
      });
      if (s.notifications.syncErrors) void notify("Platinum Hunter sync failed", r.message);
    }
  }
}

/** Returns a user-facing reason if a sync must wait (opt-in off or the hourly cooldown). */
async function syncBlockedReason(): Promise<string | null> {
  if (!app().settings.psn.optIn) return "PSN sync is turned off.";
  const remaining = cooldownRemainingMs(await lastSyncAttempt());
  return remaining > 0 ? `Platinum Hunter syncs at most once an hour to protect your account. Next sync in ${formatCooldown(remaining)}.` : null;
}

/**
 * Syncs one game. Respects the one-sync-per-hour rule unless `firstSync` is set (the
 * initial sync right after linking or importing a game).
 */
export async function syncGame(setId: string, gameTitle?: string, opts: { firstSync?: boolean } = {}): Promise<SyncResult | undefined> {
  if (app().syncingSets[setId]) return;
  const blocked = opts.firstSync ? (app().settings.psn.optIn ? null : "PSN sync is turned off.") : await syncBlockedReason();
  if (blocked) {
    app().toast({ kind: "info", title: "Sync not available yet", body: blocked });
    return;
  }
  app().setSyncing(setId, true);
  try {
    const r = await syncSet(getServices().db, getServices().psn, setId);
    reportSync([r], { [setId]: gameTitle ?? "Game" });
    if (r.errorKind === "auth_expired" || r.errorKind === "not_connected") await refreshPsnStatus();
    return r;
  } catch (e) {
    app().toast({ kind: "error", title: "Sync failed", body: errorMessage(e) });
  } finally {
    app().setSyncing(setId, false);
    app().invalidate();
  }
}

export async function syncEverything(opts: { quietIfBlocked?: boolean } = {}): Promise<SyncResult[]> {
  const blocked = await syncBlockedReason();
  if (blocked) {
    if (!opts.quietIfBlocked) app().toast({ kind: "info", title: "Sync not available yet", body: blocked });
    return [];
  }
  app().setSyncing("*", true);
  try {
    const { db, psn } = getServices();
    const names = Object.fromEntries(
      (await db.select<{ id: string; title: string }>("SELECT s.id, g.title FROM trophy_sets s JOIN games g ON g.id = s.game_id")).map((r) => [r.id, r.title]),
    );
    const results = await syncAllBound(db, psn);
    reportSync(results, names);
    return results;
  } finally {
    app().setSyncing("*", false);
    app().invalidate();
  }
}

// ---------------------------------------------------------------- sessions

export async function startPlaying(gameId: string) {
  const id = await run(() => sessions.startSession(getServices().db, gameId), "Could not start session");
  if (id) {
    await updateSettings({ lastGameId: gameId });
    app().navigate("session", { gameId });
  }
  return id;
}

export const pauseSession = (id: string) => run(() => sessions.pauseSession(getServices().db, id), "Could not pause session");
export const resumeSession = (id: string) => run(() => sessions.resumeSession(getServices().db, id), "Could not resume session");

export async function endSession(id: string, setId?: string, gameTitle?: string) {
  const ok = await run(() => sessions.endSession(getServices().db, id), "Could not end session");
  if (ok === undefined) return;
  app().toast({ kind: "success", title: "Session ended", body: "Saved to Session History." });
  const s = app().settings;
  if (s.syncOnSessionEnd && setId && app().psn?.connected && s.psn.optIn) {
    // Pull trophies earned during the session (only if the hourly cooldown has passed).
    if (!(await syncBlockedReason())) await syncGame(setId, gameTitle);
  }
}

export const addObjective = (sessionId: string, trophyId: string) =>
  run(() => sessions.addObjective(getServices().db, sessionId, trophyId), "Could not add objective");
export const removeObjective = (sessionId: string, trophyId: string) =>
  run(() => sessions.removeObjective(getServices().db, sessionId, trophyId), "Could not remove objective");
export const saveSessionNotes = (sessionId: string, notes: string) =>
  run(() => sessions.updateSessionNotes(getServices().db, sessionId, notes), "Could not save notes");

export async function skipTrophy(trophyId: string, name: string) {
  const hours = app().settings.skipHours;
  const ok = await run(() => sessions.skipTrophy(getServices().db, trophyId, hours), "Could not skip");
  if (ok !== undefined) {
    app().toast({ kind: "info", title: `Skipped "${name}" for ${hours}h`, body: "It stays on your list and returns automatically.", action: { label: "Undo", run: () => void unskip(trophyId) } });
  }
}
export const unskip = (trophyId: string) => run(() => sessions.unskipTrophy(getServices().db, trophyId), "Could not undo skip");

export async function workOn(gameId: string, trophyId: string, name: string) {
  const { db } = getServices();
  await run(async () => {
    await sessions.setFocus(db, gameId, trophyId);
    const open = await sessions.getOpenSession(db);
    if (open && open.gameId === gameId) await sessions.addObjective(db, open.id, trophyId);
  }, "Could not set focus");
  app().toast({ kind: "info", title: `Now hunting: ${name}`, body: "Added to your current focus and session objectives." });
}
export const clearFocus = (gameId: string) => run(() => sessions.setFocus(getServices().db, gameId, null), "Could not clear focus");
export const saveNote = (trophyId: string, note: string) => run(() => sessions.setNote(getServices().db, trophyId, note), "Could not save note");

// ---------------------------------------------------------------- progress answers (manual)

export async function answerQuestion(gameId: string, q: Question, answer: boolean | number | string | null, extra?: { prevCheckpointIndex?: number; checkpointIndex?: number }) {
  const { db } = getServices();
  await run(async () => {
    switch (q.kind) {
      case "story":
        if (answer === true && extra?.checkpointIndex !== undefined) await setStoryIndex(db, gameId, extra.checkpointIndex);
        if (answer === false && extra?.prevCheckpointIndex !== undefined) await setStoryIndex(db, gameId, extra.prevCheckpointIndex);
        break;
      case "flag":
        await setFlag(db, gameId, q.flagId!, typeof answer === "boolean" ? answer : null);
        break;
      case "counter":
        await setCounter(db, gameId, q.counterKey!, typeof answer === "number" ? answer : null);
        break;
      case "ending":
        await setEnding(db, gameId, (answer as "A" | "B" | "C" | "not_reached" | null) ?? null);
        break;
      case "trophy":
        if (q.trophyId && typeof answer === "boolean") await setManualStatus(db, q.trophyId, answer ? "earned" : "locked");
        break;
    }
  }, "Could not save answer");
}

export const setStory = (gameId: string, idx: number | null) => run(() => setStoryIndex(getServices().db, gameId, idx), "Could not save story progress");
export const setGameEnding = (gameId: string, e: "A" | "B" | "C" | "not_reached" | null) => run(() => setEnding(getServices().db, gameId, e), "Could not save");
export const setGameFlag = (gameId: string, flag: string, v: boolean | null) => run(() => setFlag(getServices().db, gameId, flag, v), "Could not save");
export const setGameCounter = (gameId: string, key: string, v: number | null) => run(() => setCounter(getServices().db, gameId, key, v), "Could not save");
