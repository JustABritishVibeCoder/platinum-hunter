/**
 * Library-wide aggregates for the dashboard, library, history and statistics screens.
 * Everything is derived from stored records; nothing is estimated or padded.
 */
import { listGames, loadBundle } from "../db/repo/games";
import { listSessions } from "../db/repo/sessions";
import { listEvents, recentEarned } from "../db/repo/status";
import type { GameBundle } from "../domain/bundle";
import { computeCompletion, type Completion } from "../domain/completion";
import { estimateTime } from "../domain/estimates";
import { buildProgressContext } from "../domain/progress";
import { recommend, type Recommendation } from "../domain/recommend";
import { sessionDurationMs, trophiesForSession, type SessionTrophy } from "../domain/sessions";
import type { RecommendationMode, Session, SessionSegment } from "../domain/types";
import { getServices } from "./services";

export interface GameSummary {
  bundle: GameBundle;
  completion: Completion;
  next: Recommendation | null;
  /** Sum of estimated remaining time for required trophies; null if any estimate is missing. */
  remainingMinutes: number | null;
  remainingKnownShare: number;
  lastSession: Session | null;
}

export interface SessionRow {
  session: Session;
  segments: SessionSegment[];
  trophies: SessionTrophy[];
  durationMs: number;
  gameTitle: string;
  platform: string;
  edition: string;
}

export interface Overview {
  games: GameSummary[];
  sessions: SessionRow[];
  recent: Awaited<ReturnType<typeof recentEarned>>;
}

export async function loadOverview(opts: { includeSample: boolean; mode: RecommendationMode; staleHours: number; includeOptional: boolean }): Promise<Overview> {
  const db = getServices().db;
  const now = new Date();
  const games = await listGames(db, { includeSample: opts.includeSample });
  const [sessionsRaw, events, recent] = await Promise.all([
    listSessions(db, { includeSample: opts.includeSample }),
    listEvents(db),
    recentEarned(db, 12),
  ]);
  const lastByGame = new Map<string, Session>();
  for (const s of sessionsRaw) if (!lastByGame.has(s.session.gameId)) lastByGame.set(s.session.gameId, s.session);

  const summaries: GameSummary[] = [];
  for (const g of games) {
    const bundle = await loadBundle(db, g.id, { now, staleHours: opts.staleHours });
    if (!bundle) continue;
    const completion = computeCompletion(bundle.trophies);
    const rec = recommend(bundle, opts.mode, { now, includeOptional: opts.includeOptional });
    const ctx = buildProgressContext(bundle);
    let total = 0;
    let known = 0;
    let remaining = 0;
    for (const tv of bundle.trophies) {
      if (!tv.requiredForPlatinum || tv.trophy.grade === "platinum" || tv.status.earned === true) continue;
      remaining++;
      const t = estimateTime(tv, ctx, bundle).minutes;
      if (t !== null && !tv.guidance?.passive) {
        total += t;
        known++;
      } else if (tv.guidance?.passive) known++;
    }
    summaries.push({
      bundle,
      completion,
      next: rec.ranked[0] ?? null,
      remainingMinutes: remaining > 0 && known === remaining ? total : remaining === 0 ? 0 : null,
      remainingKnownShare: remaining ? known / remaining : 1,
      lastSession: lastByGame.get(g.id) ?? null,
    });
  }

  const gameById = new Map(summaries.map((s) => [s.bundle.game.id, s.bundle.game]));
  const sessions: SessionRow[] = sessionsRaw.map((s) => {
    const g = gameById.get(s.session.gameId);
    return {
      ...s,
      trophies: trophiesForSession(s.session, events, now),
      durationMs: sessionDurationMs(s.segments, now),
      gameTitle: g?.title ?? "Removed game",
      platform: g?.platform ?? "",
      edition: g?.edition ?? "",
    };
  });

  return { games: summaries, sessions, recent };
}
