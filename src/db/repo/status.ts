import type { StatusEvent } from "../../domain/types";
import type { SqlDriver, SqlStatement } from "../driver";
import { selectOne } from "../driver";
import { nowIso } from "../util";

/**
 * Records a MANUAL status change. This never touches the PSN columns, so a manual mark
 * can never be mistaken for, or overwrite, a verified result.
 * Passing `null` clears the manual mark.
 */
export async function setManualStatus(
  db: SqlDriver,
  trophyId: string,
  state: "earned" | "locked" | null,
  opts: { sessionId?: string | null; now?: Date } = {},
): Promise<void> {
  const ts = nowIso(opts.now);
  const prev = await selectOne<{ manual_state: string | null }>(db, "SELECT manual_state FROM trophy_status WHERE trophy_id = ?", [trophyId]);
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO trophy_status (trophy_id, manual_state, manual_updated_at) VALUES (?, ?, ?)
            ON CONFLICT(trophy_id) DO UPDATE SET manual_state = excluded.manual_state, manual_updated_at = excluded.manual_updated_at`,
      params: [trophyId, state, state ? ts : null],
    },
  ];
  if (state) {
    statements.push({
      sql: `INSERT INTO status_events (trophy_id, at, source, from_state, to_state, earned_at, session_id) VALUES (?, ?, 'manual', ?, ?, ?, ?)`,
      params: [trophyId, ts, prev?.manual_state ?? null, state, state === "earned" ? ts : null, opts.sessionId ?? null],
    });
  }
  if (state === "earned") {
    // Earned trophies leave the skip list and stop being the focus.
    statements.push({ sql: "DELETE FROM recommendation_skips WHERE trophy_id = ?", params: [trophyId] });
    statements.push({ sql: "DELETE FROM game_focus WHERE trophy_id = ?", params: [trophyId] });
  }
  await db.batch(statements);
}

type Row = Record<string, string | number | null>;

export function mapEvent(r: Row): StatusEvent {
  return {
    id: r.id as number,
    trophyId: r.trophy_id as string,
    at: r.at as string,
    source: r.source as StatusEvent["source"],
    fromState: (r.from_state as string) ?? null,
    toState: r.to_state as StatusEvent["toState"],
    earnedAt: (r.earned_at as string) ?? null,
    sessionId: (r.session_id as string) ?? null,
  };
}

export async function listEvents(db: SqlDriver, opts: { gameId?: string; limit?: number } = {}): Promise<StatusEvent[]> {
  const rows = opts.gameId
    ? await db.select<Row>(
        `SELECT e.* FROM status_events e JOIN trophies t ON t.id = e.trophy_id WHERE t.game_id = ? ORDER BY e.at DESC LIMIT ?`,
        [opts.gameId, opts.limit ?? 5000],
      )
    : await db.select<Row>("SELECT * FROM status_events ORDER BY at DESC LIMIT ?", [opts.limit ?? 5000]);
  return rows.map(mapEvent);
}

export interface RecentTrophy {
  trophyId: string;
  name: string;
  grade: string;
  gameId: string;
  gameTitle: string;
  platform: string;
  earnedAt: string;
  basis: "psn" | "manual";
  iconUrl: string | null;
}

/** Most recently earned trophies, newest first, PSN and manual clearly labelled. */
export async function recentEarned(db: SqlDriver, limit = 10): Promise<RecentTrophy[]> {
  const rows = await db.select<Row>(
    `SELECT t.id AS trophy_id, t.name, t.grade, t.icon_url, g.id AS game_id, g.title, g.platform,
            CASE WHEN s.psn_state = 'earned' THEN s.psn_earned_at ELSE s.manual_updated_at END AS earned_at,
            CASE WHEN s.psn_state = 'earned' THEN 'psn' ELSE 'manual' END AS basis
     FROM trophy_status s
     JOIN trophies t ON t.id = s.trophy_id
     JOIN games g ON g.id = t.game_id
     WHERE g.is_sample = 0 AND (s.psn_state = 'earned' OR s.manual_state = 'earned')
     ORDER BY earned_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows
    .filter((r) => r.earned_at)
    .map((r) => ({
      trophyId: r.trophy_id as string,
      name: r.name as string,
      grade: r.grade as string,
      gameId: r.game_id as string,
      gameTitle: r.title as string,
      platform: r.platform as string,
      earnedAt: r.earned_at as string,
      basis: r.basis as "psn" | "manual",
      iconUrl: (r.icon_url as string) ?? null,
    }));
}
