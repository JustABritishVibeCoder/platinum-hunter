import { guidanceSchema } from "../../catalog/schema";
import { EMPTY_META, emptyProgress, type GameBundle, type GameMeta, type TrophyView } from "../../domain/bundle";
import { resolveStatus } from "../../domain/status";
import type {
  Game,
  Grade,
  Platform,
  SetSyncState,
  Trophy,
  TrophyGroup,
  TrophyGuidance,
  TrophySet,
  TrophyStatusRecord,
  UserProgress,
} from "../../domain/types";
import type { SqlDriver } from "../driver";
import { selectOne } from "../driver";
import { bool, newId, nowIso, parseJson } from "../util";
import { setIdFor, trophyIdFor } from "./catalogImport";

type Row = Record<string, string | number | null>;

export function mapGame(r: Row): Game {
  return {
    id: r.id as string,
    title: r.title as string,
    platform: r.platform as Platform,
    edition: r.edition as string,
    region: (r.region as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    source: r.source as Game["source"],
    isSample: bool(r.is_sample),
    catalogId: (r.catalog_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapSet(r: Row): TrophySet {
  return {
    id: r.id as string,
    gameId: r.game_id as string,
    platform: r.platform as Platform,
    npCommunicationId: (r.np_communication_id as string) ?? null,
    npServiceName: (r.np_service_name as TrophySet["npServiceName"]) ?? null,
    npTitleIds: parseJson<string[]>(r.np_title_ids, []),
    trophySetVersion: (r.trophy_set_version as string) ?? null,
    bindingStatus: r.binding_status as TrophySet["bindingStatus"],
    datasetSource: (r.dataset_source as string) ?? null,
    datasetSourceUrl: (r.dataset_source_url as string) ?? null,
    datasetRetrievedAt: (r.dataset_retrieved_at as string) ?? null,
    datasetCompleteness: r.dataset_completeness as TrophySet["datasetCompleteness"],
    datasetNotes: (r.dataset_notes as string) ?? null,
    idsVerified: bool(r.ids_verified),
  };
}

export function mapTrophy(r: Row): Trophy {
  return {
    id: r.id as string,
    setId: r.set_id as string,
    gameId: r.game_id as string,
    psnTrophyId: r.psn_trophy_id as number,
    groupKey: r.group_key as string,
    name: r.name as string,
    description: r.description as string,
    grade: r.grade as Grade,
    hidden: bool(r.hidden),
    iconUrl: (r.icon_url as string) ?? null,
    factsSource: r.facts_source as Trophy["factsSource"],
    factsVerifiedAt: (r.facts_verified_at as string) ?? null,
    psnEarnedRate: (r.psn_earned_rate as number) ?? null,
    psnRarity: (r.psn_rarity as number) ?? null,
    communityEarnedRate: (r.community_earned_rate as number) ?? null,
    communityRateSource: (r.community_rate_source as string) ?? null,
    communityRateRetrievedAt: (r.community_rate_retrieved_at as string) ?? null,
    sortOrder: r.sort_order as number,
  };
}

export function mapStatus(r: Row): TrophyStatusRecord {
  return {
    trophyId: r.trophy_id as string,
    psnState: (r.psn_state as TrophyStatusRecord["psnState"]) ?? null,
    psnEarnedAt: (r.psn_earned_at as string) ?? null,
    psnConfirmedAt: (r.psn_confirmed_at as string) ?? null,
    psnProgress: (r.psn_progress as string) ?? null,
    psnProgressTarget: (r.psn_progress_target as string) ?? null,
    manualState: (r.manual_state as TrophyStatusRecord["manualState"]) ?? null,
    manualUpdatedAt: (r.manual_updated_at as string) ?? null,
  };
}

export function mapSync(r: Row | null, setId: string): SetSyncState {
  if (!r) return { setId, status: "never", lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null };
  return {
    setId,
    status: r.status as SetSyncState["status"],
    lastAttemptAt: (r.last_attempt_at as string) ?? null,
    lastSuccessAt: (r.last_success_at as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    lastErrorAt: (r.last_error_at as string) ?? null,
  };
}

/** Parses stored guidance JSON; invalid rows are ignored rather than trusted. */
export function mapGuidance(trophyId: string, raw: unknown, source: string | null, date: string | null): TrophyGuidance | null {
  const parsed = guidanceSchema.safeParse(parseJson(raw, null));
  if (!parsed.success) return null;
  const g = parsed.data;
  return {
    trophyId,
    category: g.category,
    gameMode: g.gameMode,
    character: g.character,
    difficulty: g.difficulty,
    minutes: g.minutes,
    confidence: g.confidence,
    estimateBasis: g.estimateBasis,
    estimateSource: source,
    estimateDate: date,
    passive: g.passive,
    onlineRequired: g.onlineRequired,
    multiplayer: g.multiplayer,
    missable: g.missable,
    prereqs: g.prereqs,
    softPrereqs: g.softPrereqs,
    relatedPsnIds: g.related,
    phase: g.phase,
    summary: g.summary,
    steps: g.steps,
    guides: g.guides,
    storyCheckpoint: g.storyCheckpoint,
    counter: g.counter,
    guidanceSource: source,
  };
}

export async function listGames(db: SqlDriver, opts: { includeSample?: boolean } = {}): Promise<Game[]> {
  const rows = await db.select<Row>(
    `SELECT * FROM games ${opts.includeSample ? "" : "WHERE is_sample = 0"} ORDER BY updated_at DESC`,
  );
  return rows.map(mapGame);
}

export async function getGame(db: SqlDriver, id: string): Promise<Game | null> {
  const r = await selectOne<Row>(db, "SELECT * FROM games WHERE id = ?", [id]);
  return r ? mapGame(r) : null;
}

export async function loadProgress(db: SqlDriver, gameId: string): Promise<UserProgress> {
  const rows = await db.select<{ key: string; value: string; updated_at: string }>(
    "SELECT key, value, updated_at FROM user_progress WHERE game_id = ?",
    [gameId],
  );
  const p = emptyProgress();
  for (const r of rows) {
    const v = parseJson<unknown>(r.value, null);
    p.updatedAt[r.key] = r.updated_at;
    if (r.key === "story_index" && typeof v === "number") p.storyIndex = v;
    else if (r.key === "ending" && (v === "A" || v === "B" || v === "C" || v === "not_reached")) p.ending = v;
    else if (r.key.startsWith("flag:") && (typeof v === "boolean" || v === null)) p.flags[r.key.slice(5)] = v;
    else if (r.key.startsWith("counter:") && (typeof v === "number" || v === null)) p.counters[r.key.slice(8)] = v;
  }
  return p;
}

export interface LoadOptions {
  now?: Date;
  staleHours?: number;
}

export async function loadBundle(db: SqlDriver, gameId: string, opts: LoadOptions = {}): Promise<GameBundle | null> {
  const now = opts.now ?? new Date();
  const gameRow = await selectOne<Row>(db, "SELECT * FROM games WHERE id = ?", [gameId]);
  if (!gameRow) return null;
  const setRow = await selectOne<Row>(db, "SELECT * FROM trophy_sets WHERE game_id = ? ORDER BY id LIMIT 1", [gameId]);
  if (!setRow) return null;
  const set = mapSet(setRow);
  const [groupRows, trophyRows, guidanceRows, statusRows, syncRow, metaRow, skipRows, focusRow] = await Promise.all([
    db.select<Row>("SELECT * FROM trophy_groups WHERE set_id = ? ORDER BY sort_order", [set.id]),
    db.select<Row>("SELECT * FROM trophies WHERE set_id = ? ORDER BY sort_order, psn_trophy_id", [set.id]),
    db.select<Row>(
      "SELECT g.trophy_id, g.data, g.source, g.source_date FROM trophy_guidance g JOIN trophies t ON t.id = g.trophy_id WHERE t.set_id = ?",
      [set.id],
    ),
    db.select<Row>("SELECT s.* FROM trophy_status s JOIN trophies t ON t.id = s.trophy_id WHERE t.set_id = ?", [set.id]),
    selectOne<Row>(db, "SELECT * FROM sync_state WHERE set_id = ?", [set.id]),
    selectOne<Row>(db, "SELECT data FROM game_meta WHERE game_id = ?", [gameId]),
    db.select<Row>(
      "SELECT k.trophy_id, k.until FROM recommendation_skips k JOIN trophies t ON t.id = k.trophy_id WHERE t.set_id = ?",
      [set.id],
    ),
    selectOne<Row>(db, "SELECT trophy_id FROM game_focus WHERE game_id = ?", [gameId]),
  ]);
  const groups: TrophyGroup[] = groupRows.map((r) => ({
    setId: r.set_id as string,
    groupKey: r.group_key as string,
    psnGroupId: (r.psn_group_id as string) ?? null,
    name: r.name as string,
    requiredForPlatinum: bool(r.required_for_platinum),
    sortOrder: r.sort_order as number,
  }));
  const groupByKey = new Map(groups.map((g) => [g.groupKey, g]));
  const guidance = new Map(
    guidanceRows.map((r) => [
      r.trophy_id as string,
      mapGuidance(r.trophy_id as string, r.data, (r.source as string) ?? null, (r.source_date as string) ?? null),
    ]),
  );
  const statuses = new Map(statusRows.map((r) => [r.trophy_id as string, mapStatus(r)]));
  const sync = mapSync(syncRow, set.id);
  const meta: GameMeta = { ...EMPTY_META, ...parseJson<Partial<GameMeta>>(metaRow?.data, {}) };

  const trophies: TrophyView[] = trophyRows.map((r) => {
    const trophy = mapTrophy(r);
    const group = groupByKey.get(trophy.groupKey);
    return {
      trophy,
      guidance: guidance.get(trophy.id) ?? null,
      status: resolveStatus(statuses.get(trophy.id), sync, now, opts.staleHours),
      // Unknown groups default to required: safer to over- than under-report work.
      requiredForPlatinum: group ? group.requiredForPlatinum : true,
      groupName: group?.name ?? "Trophies",
    };
  });

  return {
    game: mapGame(gameRow),
    set,
    groups,
    meta,
    trophies,
    sync,
    progress: await loadProgress(db, gameId),
    skips: Object.fromEntries(skipRows.map((r) => [r.trophy_id as string, r.until as string])),
    focusTrophyId: (focusRow?.trophy_id as string) ?? null,
  };
}

export interface ManualGameInput {
  title: string;
  platform: Platform;
  edition: string;
  region?: string | null;
}

/** Adds a game without external metadata. Its trophies are manual, never verified. */
export async function createManualGame(db: SqlDriver, input: ManualGameInput, now: Date = new Date()): Promise<string> {
  const id = newId("game");
  const setId = setIdFor(id);
  const ts = nowIso(now);
  await db.batch([
    {
      sql: `INSERT INTO games (id, title, platform, edition, region, cover_url, source, is_sample, catalog_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, 'manual', 0, NULL, ?, ?)`,
      params: [id, input.title.trim(), input.platform, input.edition.trim() || "Standard", input.region ?? null, ts, ts],
    },
    {
      sql: `INSERT INTO trophy_sets (id, game_id, platform, np_service_name, binding_status, dataset_source, dataset_completeness, dataset_notes)
            VALUES (?, ?, ?, ?, 'unbound', 'Entered manually', 'unknown', 'Trophies added by hand. Connect PSN and link this game to verify them.')`,
      params: [setId, id, input.platform, input.platform === "PS5" ? "trophy2" : "trophy"],
    },
    {
      sql: "INSERT INTO trophy_groups (set_id, group_key, psn_group_id, name, required_for_platinum, sort_order) VALUES (?, 'default', 'default', 'Base Game', 1, 0)",
      params: [setId],
    },
    { sql: "INSERT INTO sync_state (set_id, status) VALUES (?, 'never')", params: [setId] },
  ]);
  return id;
}

export async function addManualTrophy(
  db: SqlDriver,
  gameId: string,
  input: { name: string; description: string; grade: Grade },
): Promise<string> {
  const setId = setIdFor(gameId);
  const next = await selectOne<{ n: number | null }>(db, "SELECT MAX(psn_trophy_id) AS n FROM trophies WHERE set_id = ?", [setId]);
  const psnId = (next?.n ?? -1) + 1;
  const id = trophyIdFor(setId, psnId);
  await db.execute(
    `INSERT INTO trophies (id, set_id, game_id, psn_trophy_id, group_key, name, description, grade, hidden, facts_source, sort_order)
     VALUES (?, ?, ?, ?, 'default', ?, ?, ?, 0, 'manual', ?)`,
    [id, setId, gameId, psnId, input.name.trim(), input.description.trim(), input.grade, psnId],
  );
  return id;
}

export async function deleteGame(db: SqlDriver, gameId: string): Promise<void> {
  await db.execute("DELETE FROM games WHERE id = ?", [gameId]);
}

export async function touchGame(db: SqlDriver, gameId: string, now: Date = new Date()): Promise<void> {
  await db.execute("UPDATE games SET updated_at = ? WHERE id = ?", [nowIso(now), gameId]);
}
