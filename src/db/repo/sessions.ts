/**
 * Gaming sessions. Only timestamps are stored (session + segments), so elapsed time is
 * always recomputed from the clock and survives restarts. At most one session can be
 * open (active or paused) at a time.
 */
import { canTransition } from "../../domain/sessions";
import type { Session, SessionSegment } from "../../domain/types";
import type { SqlDriver } from "../driver";
import { selectOne } from "../driver";
import { newId, nowIso, bool } from "../util";

type Row = Record<string, string | number | null>;

export function mapSession(r: Row): Session {
  return {
    id: r.id as string,
    gameId: r.game_id as string,
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string) ?? null,
    status: r.status as Session["status"],
    notes: (r.notes as string) ?? "",
    isSample: bool(r.is_sample),
  };
}

function mapSegment(r: Row): SessionSegment {
  return { id: r.id as number, sessionId: r.session_id as string, startedAt: r.started_at as string, endedAt: (r.ended_at as string) ?? null };
}

export async function getOpenSession(db: SqlDriver): Promise<Session | null> {
  const r = await selectOne<Row>(db, "SELECT * FROM sessions WHERE status IN ('active','paused') ORDER BY started_at DESC LIMIT 1");
  return r ? mapSession(r) : null;
}

export async function getSession(db: SqlDriver, id: string): Promise<Session | null> {
  const r = await selectOne<Row>(db, "SELECT * FROM sessions WHERE id = ?", [id]);
  return r ? mapSession(r) : null;
}

export async function getSegments(db: SqlDriver, sessionId: string): Promise<SessionSegment[]> {
  return (await db.select<Row>("SELECT * FROM session_segments WHERE session_id = ? ORDER BY started_at", [sessionId])).map(mapSegment);
}

export class SessionError extends Error {}

/** Starts a session. If another session is open it is ended first (at `now`). */
export async function startSession(db: SqlDriver, gameId: string, now: Date = new Date()): Promise<string> {
  const open = await getOpenSession(db);
  if (open) await endSession(db, open.id, now);
  const id = newId("session");
  const ts = nowIso(now);
  await db.batch([
    { sql: "INSERT INTO sessions (id, game_id, started_at, status, notes, is_sample) VALUES (?, ?, ?, 'active', '', 0)", params: [id, gameId, ts] },
    { sql: "INSERT INTO session_segments (session_id, started_at) VALUES (?, ?)", params: [id, ts] },
    { sql: "UPDATE games SET updated_at = ? WHERE id = ?", params: [ts, gameId] },
  ]);
  return id;
}

async function requireTransition(db: SqlDriver, id: string, action: "pause" | "resume" | "end"): Promise<Session> {
  const s = await getSession(db, id);
  if (!s) throw new SessionError("Session not found.");
  if (!canTransition(s.status, action)) throw new SessionError(`Cannot ${action} a session that is ${s.status}.`);
  return s;
}

export async function pauseSession(db: SqlDriver, id: string, now: Date = new Date()): Promise<void> {
  await requireTransition(db, id, "pause");
  const ts = nowIso(now);
  await db.batch([
    { sql: "UPDATE session_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL", params: [ts, id] },
    { sql: "UPDATE sessions SET status = 'paused' WHERE id = ?", params: [id] },
  ]);
}

export async function resumeSession(db: SqlDriver, id: string, now: Date = new Date()): Promise<void> {
  await requireTransition(db, id, "resume");
  const ts = nowIso(now);
  await db.batch([
    { sql: "INSERT INTO session_segments (session_id, started_at) VALUES (?, ?)", params: [id, ts] },
    { sql: "UPDATE sessions SET status = 'active' WHERE id = ?", params: [id] },
  ]);
}

export async function endSession(db: SqlDriver, id: string, now: Date = new Date()): Promise<void> {
  const s = await requireTransition(db, id, "end");
  const ts = nowIso(now);
  await db.batch([
    { sql: "UPDATE session_segments SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL", params: [ts, id] },
    { sql: "UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?", params: [ts, id] },
    { sql: "UPDATE games SET updated_at = ? WHERE id = ?", params: [ts, s.gameId] },
  ]);
}

export async function updateSessionNotes(db: SqlDriver, id: string, notes: string): Promise<void> {
  await db.execute("UPDATE sessions SET notes = ? WHERE id = ?", [notes.slice(0, 5000), id]);
}

export async function deleteSession(db: SqlDriver, id: string): Promise<void> {
  await db.execute("DELETE FROM sessions WHERE id = ?", [id]);
}

export async function listSessions(
  db: SqlDriver,
  opts: { gameId?: string; includeSample?: boolean; limit?: number } = {},
): Promise<{ session: Session; segments: SessionSegment[] }[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.gameId) {
    where.push("game_id = ?");
    params.push(opts.gameId);
  }
  if (!opts.includeSample) where.push("is_sample = 0");
  params.push(opts.limit ?? 1000);
  const rows = await db.select<Row>(
    `SELECT * FROM sessions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at DESC LIMIT ?`,
    params,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const segs = await db.select<Row>(
    `SELECT * FROM session_segments WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY started_at`,
    ids,
  );
  const bySession = new Map<string, SessionSegment[]>();
  for (const s of segs.map(mapSegment)) {
    const list = bySession.get(s.sessionId) ?? [];
    list.push(s);
    bySession.set(s.sessionId, list);
  }
  return rows.map((r) => ({ session: mapSession(r), segments: bySession.get(r.id as string) ?? [] }));
}

export async function addObjective(db: SqlDriver, sessionId: string, trophyId: string, now: Date = new Date()): Promise<void> {
  await db.execute("INSERT OR IGNORE INTO session_objectives (session_id, trophy_id, added_at) VALUES (?, ?, ?)", [sessionId, trophyId, nowIso(now)]);
}

export async function removeObjective(db: SqlDriver, sessionId: string, trophyId: string): Promise<void> {
  await db.execute("DELETE FROM session_objectives WHERE session_id = ? AND trophy_id = ?", [sessionId, trophyId]);
}

export async function listObjectives(db: SqlDriver, sessionId: string): Promise<string[]> {
  return (await db.select<{ trophy_id: string }>("SELECT trophy_id FROM session_objectives WHERE session_id = ? ORDER BY added_at", [sessionId])).map(
    (r) => r.trophy_id,
  );
}

/** Temporarily deprioritise a recommendation. Never marks it earned or removes it. */
export async function skipTrophy(db: SqlDriver, trophyId: string, hours: number, now: Date = new Date()): Promise<void> {
  const until = new Date(now.getTime() + hours * 3600_000);
  await db.execute(
    `INSERT INTO recommendation_skips (trophy_id, skipped_at, until) VALUES (?, ?, ?)
     ON CONFLICT(trophy_id) DO UPDATE SET skipped_at = excluded.skipped_at, until = excluded.until`,
    [trophyId, nowIso(now), nowIso(until)],
  );
}

export async function unskipTrophy(db: SqlDriver, trophyId: string): Promise<void> {
  await db.execute("DELETE FROM recommendation_skips WHERE trophy_id = ?", [trophyId]);
}

export async function setFocus(db: SqlDriver, gameId: string, trophyId: string | null, now: Date = new Date()): Promise<void> {
  if (!trophyId) {
    await db.execute("DELETE FROM game_focus WHERE game_id = ?", [gameId]);
    return;
  }
  await db.execute(
    `INSERT INTO game_focus (game_id, trophy_id, set_at) VALUES (?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET trophy_id = excluded.trophy_id, set_at = excluded.set_at`,
    [gameId, trophyId, nowIso(now)],
  );
}

export async function getNote(db: SqlDriver, trophyId: string): Promise<string> {
  return (await selectOne<{ note: string }>(db, "SELECT note FROM trophy_notes WHERE trophy_id = ?", [trophyId]))?.note ?? "";
}

export async function setNote(db: SqlDriver, trophyId: string, note: string, now: Date = new Date()): Promise<void> {
  if (!note.trim()) {
    await db.execute("DELETE FROM trophy_notes WHERE trophy_id = ?", [trophyId]);
    return;
  }
  await db.execute(
    `INSERT INTO trophy_notes (trophy_id, note, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(trophy_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
    [trophyId, note.slice(0, 5000), nowIso(now)],
  );
}
