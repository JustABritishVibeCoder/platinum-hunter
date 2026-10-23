/**
 * Session timing. Durations are computed from stored timestamps, never from a running
 * in-memory timer, so they stay correct across app restarts, sleep and crashes.
 * Note: this measures time since "Start Playing" was pressed, not console playtime.
 */
import type { Session, SessionSegment, StatusEvent } from "./types";

export function segmentDurationMs(seg: Pick<SessionSegment, "startedAt" | "endedAt">, now: Date): number {
  const start = Date.parse(seg.startedAt);
  const end = seg.endedAt ? Date.parse(seg.endedAt) : now.getTime();
  return Math.max(0, end - start);
}

export function sessionDurationMs(segments: Pick<SessionSegment, "startedAt" | "endedAt">[], now: Date = new Date()): number {
  return segments.reduce((sum, s) => sum + segmentDurationMs(s, now), 0);
}

export type SessionAction = "pause" | "resume" | "end";

export function canTransition(status: Session["status"], action: SessionAction): boolean {
  switch (action) {
    case "pause":
      return status === "active";
    case "resume":
      return status === "paused";
    case "end":
      return status === "active" || status === "paused";
  }
}

export function formatDuration(ms: number, withSeconds = true): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : h ? `${h}h ${pad(m)}m` : `${m}m`;
}

export interface SessionTrophy {
  trophyId: string;
  source: "psn" | "manual";
  at: string;
}

/**
 * Trophies attributed to a session.
 *  - PSN-verified: the PSN earned timestamp falls inside the session window.
 *  - Manual: the manual change was recorded while this session was running.
 */
export function trophiesForSession(
  session: Pick<Session, "id" | "startedAt" | "endedAt">,
  events: StatusEvent[],
  now: Date = new Date(),
): SessionTrophy[] {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now.getTime();
  const out = new Map<string, SessionTrophy>();
  for (const e of events) {
    if (e.toState !== "earned") continue;
    if (e.source === "psn") {
      const t = e.earnedAt ? Date.parse(e.earnedAt) : NaN;
      if (!Number.isNaN(t) && t >= start && t <= end) out.set(`psn:${e.trophyId}`, { trophyId: e.trophyId, source: "psn", at: e.earnedAt! });
    } else if (e.sessionId === session.id) {
      out.set(`manual:${e.trophyId}`, { trophyId: e.trophyId, source: "manual", at: e.at });
    }
  }
  // A trophy confirmed by PSN supersedes its manual mark in the same session.
  for (const key of [...out.keys()]) {
    if (key.startsWith("manual:") && out.has(`psn:${key.slice(7)}`)) out.delete(key);
  }
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export interface SessionStats {
  count: number;
  totalMs: number;
  averageMs: number;
  longestMs: number;
  longestSessionId: string | null;
  trophiesVerified: number;
  trophiesManual: number;
  trophiesPerSession: number;
}

export function computeSessionStats(
  sessions: { session: Session; segments: SessionSegment[]; trophies: SessionTrophy[] }[],
  now: Date = new Date(),
): SessionStats {
  let totalMs = 0;
  let longestMs = 0;
  let longestSessionId: string | null = null;
  let trophiesVerified = 0;
  let trophiesManual = 0;
  for (const s of sessions) {
    const d = sessionDurationMs(s.segments, now);
    totalMs += d;
    if (d > longestMs) {
      longestMs = d;
      longestSessionId = s.session.id;
    }
    for (const t of s.trophies) {
      if (t.source === "psn") trophiesVerified++;
      else trophiesManual++;
    }
  }
  const count = sessions.length;
  return {
    count,
    totalMs,
    averageMs: count ? totalMs / count : 0,
    longestMs,
    longestSessionId,
    trophiesVerified,
    trophiesManual,
    trophiesPerSession: count ? (trophiesVerified + trophiesManual) / count : 0,
  };
}
