/** Player-supplied progress answers. These are always MANUAL information. */
import type { SqlDriver, SqlValue } from "../driver";
import { nowIso } from "../util";

async function put(db: SqlDriver, gameId: string, key: string, value: unknown, now?: Date) {
  if (value === undefined) {
    await db.execute("DELETE FROM user_progress WHERE game_id = ? AND key = ?", [gameId, key]);
    return;
  }
  await db.execute(
    `INSERT INTO user_progress (game_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [gameId, key, JSON.stringify(value) as SqlValue, nowIso(now)],
  );
}

export const setStoryIndex = (db: SqlDriver, gameId: string, index: number | null) =>
  index === null ? put(db, gameId, "story_index", undefined) : put(db, gameId, "story_index", Math.max(0, Math.floor(index)));

export const setEnding = (db: SqlDriver, gameId: string, ending: "A" | "B" | "C" | "not_reached" | null) =>
  put(db, gameId, "ending", ending ?? undefined);

export const setFlag = (db: SqlDriver, gameId: string, flag: string, value: boolean | null) =>
  put(db, gameId, `flag:${flag}`, value ?? undefined);

export const setCounter = (db: SqlDriver, gameId: string, key: string, value: number | null) =>
  put(db, gameId, `counter:${key}`, value === null || Number.isNaN(value) ? undefined : Math.max(0, value));
