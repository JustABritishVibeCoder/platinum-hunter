/**
 * TrophySyncService: pulls authoritative trophy data from PSN into SQLite.
 *
 * Guarantees:
 *  - All network calls and validation happen BEFORE any write. If anything fails, the
 *    sync is recorded as failed and every previously verified status is left exactly
 *    as it was (the UI shows SYNC_ERROR with the last good timestamp).
 *  - All writes of a successful sync are applied in one transaction.
 *  - Success is only reported after that transaction commits.
 *  - Manual marks are never modified by a sync.
 */
import { normaliseName, setIdFor, trophyIdFor } from "../db/repo/catalogImport";
import type { SqlDriver, SqlStatement } from "../db/driver";
import { errorMessage, isBackendError, selectOne } from "../db/driver";
import { newId, nowIso } from "../db/util";
import type { NpServiceName, Platform } from "../domain/types";
import { evaluateCandidates, platformFromPsn, serviceFor, type BindingCandidate } from "./binding";
import type { PsnGateway } from "./gateway";
import {
  parseTitles,
  titleTrophiesResponseSchema,
  trophyGroupsResponseSchema,
  userEarnedResponseSchema,
  validate,
  type PsnTrophyTitle,
} from "./schemas";

export interface SyncResult {
  ok: boolean;
  setId: string;
  message: string;
  errorKind?: string;
  retryAfterSecs?: number;
  newlyEarned: string[];
  importedEarned: number;
  changes: number;
  warnings: string[];
  finishedAt: string;
}

type Row = Record<string, string | number | null>;

async function log(db: SqlDriver, setId: string | null, startedAt: string, ok: boolean, message: string, changes = 0) {
  await db.execute("INSERT INTO sync_log (set_id, started_at, finished_at, ok, message, changes) VALUES (?, ?, ?, ?, ?, ?)", [
    setId,
    startedAt,
    nowIso(),
    ok ? 1 : 0,
    message.slice(0, 1000),
    changes,
  ]);
}

export async function recordFailure(db: SqlDriver, setId: string, startedAt: string, error: unknown): Promise<SyncResult> {
  const message = errorMessage(error);
  const at = nowIso();
  await db.execute(
    `INSERT INTO sync_state (set_id, status, last_attempt_at, last_error, last_error_at) VALUES (?, 'error', ?, ?, ?)
     ON CONFLICT(set_id) DO UPDATE SET status = 'error', last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
    [setId, startedAt, message, at],
  );
  await log(db, setId, startedAt, false, message);
  return {
    ok: false,
    setId,
    message,
    errorKind: isBackendError(error) ? error.kind : "error",
    retryAfterSecs: isBackendError(error) ? error.retryAfterSecs : undefined,
    newlyEarned: [],
    importedEarned: 0,
    changes: 0,
    warnings: [],
    finishedAt: at,
  };
}

// ---------------------------------------------------------------- binding

export async function fetchTitles(gateway: PsnGateway): Promise<{ titles: PsnTrophyTitle[]; rejected: number }> {
  return parseTitles(await gateway.userTitles());
}

export async function bindingCandidates(db: SqlDriver, setId: string, titles: PsnTrophyTitle[]): Promise<BindingCandidate[]> {
  const set = await selectOne<Row>(
    db,
    "SELECT s.platform, s.np_service_name, g.title, g.catalog_id FROM trophy_sets s JOIN games g ON g.id = s.game_id WHERE s.id = ?",
    [setId],
  );
  if (!set) return [];
  const expected = await db.select<{ grade: string; n: number }>("SELECT grade, COUNT(*) AS n FROM trophies WHERE set_id = ? GROUP BY grade", [setId]);
  const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 } as Record<string, number>;
  for (const r of expected) counts[r.grade] = r.n;
  const dataset = await selectOne<{ dataset_completeness: string }>(db, "SELECT dataset_completeness FROM trophy_sets WHERE id = ?", [setId]);
  return evaluateCandidates(
    {
      title: set.title as string,
      platform: set.platform as Platform,
      npServiceName: (set.np_service_name as NpServiceName) ?? null,
      expectedCounts:
        dataset?.dataset_completeness === "complete"
          ? { platinum: counts.platinum, gold: counts.gold, silver: counts.silver, bronze: counts.bronze }
          : null,
    },
    titles,
  );
}

export class BindingError extends Error {}

/** Binds a set to a specific PSN trophy list after re-checking platform and service. */
export async function bindSet(db: SqlDriver, setId: string, title: PsnTrophyTitle): Promise<void> {
  const set = await selectOne<Row>(db, "SELECT s.*, g.id AS gid FROM trophy_sets s JOIN games g ON g.id = s.game_id WHERE s.id = ?", [setId]);
  if (!set) throw new BindingError("Trophy set not found.");
  const platform = set.platform as Platform;
  const wantService = (set.np_service_name as NpServiceName) ?? serviceFor(platform);
  if (title.npServiceName !== wantService || platformFromPsn(title) !== platform) {
    throw new BindingError(
      `Refusing to link: "${title.trophyTitleName}" is a ${title.trophyTitlePlatform} (${title.npServiceName}) list but this game is ${platform} (${wantService}).`,
    );
  }
  const other = await selectOne<Row>(db, "SELECT id FROM trophy_sets WHERE np_communication_id = ? AND id <> ?", [title.npCommunicationId, setId]);
  if (other) throw new BindingError("That PSN trophy list is already linked to another game in your library.");
  await db.batch([
    {
      sql: `UPDATE trophy_sets SET np_communication_id = ?, np_service_name = ?, trophy_set_version = ?, binding_status = 'bound' WHERE id = ?`,
      params: [title.npCommunicationId, title.npServiceName, title.trophySetVersion ?? null, setId],
    },
    { sql: "UPDATE games SET cover_url = COALESCE(?, cover_url), updated_at = ? WHERE id = ?", params: [title.trophyTitleIconUrl ?? null, nowIso(), set.gid as string] },
  ]);
}

/** Creates a new game from a PSN trophy list (facts will come from PSN on first sync). */
export async function importPsnTitle(db: SqlDriver, title: PsnTrophyTitle): Promise<string> {
  const existing = await selectOne<{ game_id: string }>(db, "SELECT game_id FROM trophy_sets WHERE np_communication_id = ?", [title.npCommunicationId]);
  if (existing) return existing.game_id;
  const gameId = newId("game");
  const setId = setIdFor(gameId);
  const ts = nowIso();
  const platform = platformFromPsn(title);
  await db.batch([
    {
      sql: `INSERT INTO games (id, title, platform, edition, region, cover_url, source, is_sample, catalog_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, 'psn', 0, NULL, ?, ?)`,
      params: [gameId, title.trophyTitleName, platform, `${title.trophyTitlePlatform} trophy list`, title.trophyTitleIconUrl ?? null, ts, ts],
    },
    {
      sql: `INSERT INTO trophy_sets (id, game_id, platform, np_communication_id, np_service_name, trophy_set_version, binding_status,
              dataset_source, dataset_completeness, dataset_notes)
            VALUES (?, ?, ?, ?, ?, ?, 'bound', 'PlayStation Network', 'unknown', 'Imported from your PSN trophy list. No curated guide data yet.')`,
      params: [setId, gameId, platform, title.npCommunicationId, title.npServiceName, title.trophySetVersion ?? null],
    },
    { sql: "INSERT INTO sync_state (set_id, status) VALUES (?, 'never')", params: [setId] },
  ]);
  return gameId;
}

// ---------------------------------------------------------------- sync

export async function syncSet(db: SqlDriver, gateway: PsnGateway, setId: string): Promise<SyncResult> {
  const startedAt = nowIso();
  await db.execute(
    `INSERT INTO sync_state (set_id, status, last_attempt_at) VALUES (?, 'never', ?)
     ON CONFLICT(set_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
    [setId, startedAt],
  );
  const set = await selectOne<Row>(db, "SELECT * FROM trophy_sets WHERE id = ?", [setId]);
  if (!set) return recordFailure(db, setId, startedAt, new Error("Trophy set not found."));
  const npId = set.np_communication_id as string | null;
  const service = set.np_service_name as NpServiceName | null;
  if (!npId || !service || set.binding_status !== "bound") {
    return recordFailure(db, setId, startedAt, new Error("This game is not linked to a PSN trophy list yet. Link it on the PSN Connection page."));
  }

  // 1. Fetch + validate everything first. Any failure leaves the database untouched.
  let defs, groups, earned;
  try {
    const [rawDefs, rawGroups, rawEarned] = [
      await gateway.titleTrophies(npId, service),
      await gateway.titleTrophyGroups(npId, service),
      await gateway.userEarned(npId, service),
    ];
    defs = validate(titleTrophiesResponseSchema, rawDefs, "trophy definitions");
    groups = validate(trophyGroupsResponseSchema, rawGroups, "trophy groups");
    earned = validate(userEarnedResponseSchema, rawEarned, "earned trophy data");
    if (defs.trophies.length === 0) throw new Error("PSN returned an empty trophy list. Nothing was changed.");
  } catch (e) {
    return recordFailure(db, setId, startedAt, e);
  }

  // 2. Reconcile and write in one transaction.
  try {
    const result = await applySync(db, set, defs, groups, earned, startedAt);
    await log(db, setId, startedAt, true, result.message, result.changes);
    return result;
  } catch (e) {
    return recordFailure(db, setId, startedAt, e);
  }
}

async function applySync(
  db: SqlDriver,
  set: Row,
  defs: ReturnType<typeof titleTrophiesResponseSchema.parse>,
  groups: ReturnType<typeof trophyGroupsResponseSchema.parse>,
  earned: ReturnType<typeof userEarnedResponseSchema.parse>,
  startedAt: string,
): Promise<SyncResult> {
  const setId = set.id as string;
  const gameId = set.game_id as string;
  const now = nowIso();
  const warnings: string[] = [];
  const st: SqlStatement[] = [];

  // Groups: PSN group ids are authoritative; only the "default" group counts for the Platinum.
  const localGroups = await db.select<Row>("SELECT * FROM trophy_groups WHERE set_id = ?", [setId]);
  const groupKeyByPsn = new Map<string, string>();
  for (const g of localGroups) if (g.psn_group_id) groupKeyByPsn.set(g.psn_group_id as string, g.group_key as string);
  let order = localGroups.length;
  for (const g of groups.trophyGroups) {
    const key = groupKeyByPsn.get(g.trophyGroupId) ?? (g.trophyGroupId === "default" ? "default" : `psn-${g.trophyGroupId}`);
    groupKeyByPsn.set(g.trophyGroupId, key);
    st.push({
      sql: `INSERT INTO trophy_groups (set_id, group_key, psn_group_id, name, required_for_platinum, sort_order) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(set_id, group_key) DO UPDATE SET psn_group_id = excluded.psn_group_id, name = excluded.name,
              required_for_platinum = excluded.required_for_platinum`,
      params: [setId, key, g.trophyGroupId, g.trophyGroupName || (g.trophyGroupId === "default" ? "Base Game" : `Add-on ${g.trophyGroupId}`), g.trophyGroupId === "default" ? 1 : 0, order++],
    });
  }

  // Trophies: match by exact name first (catalog IDs may have been inferred), then by ID.
  const locals = await db.select<Row>("SELECT id, psn_trophy_id, name FROM trophies WHERE set_id = ?", [setId]);
  const used = new Set<string>();
  const localByName = new Map<string, Row>();
  for (const l of locals) localByName.set(normaliseName(l.name as string), l);
  const localByPsn = new Map(locals.map((l) => [l.psn_trophy_id as number, l]));
  const mapping = new Map<number, string>(); // PSN trophyId -> local row id
  const reassigned: { id: string; psnId: number }[] = [];

  for (const d of defs.trophies) {
    if (!d.trophyName) continue;
    const l = localByName.get(normaliseName(d.trophyName));
    if (l && !used.has(l.id as string)) {
      used.add(l.id as string);
      mapping.set(d.trophyId, l.id as string);
      if ((l.psn_trophy_id as number) !== d.trophyId) reassigned.push({ id: l.id as string, psnId: d.trophyId });
    }
  }
  for (const d of defs.trophies) {
    if (mapping.has(d.trophyId)) continue;
    const l = localByPsn.get(d.trophyId);
    if (l && !used.has(l.id as string)) {
      used.add(l.id as string);
      mapping.set(d.trophyId, l.id as string);
      if (d.trophyName) warnings.push(`Trophy #${d.trophyId} is named "${d.trophyName}" on PSN (was "${l.name}"); PSN's name is now used.`);
    }
  }
  // Two-phase ID reassignment to respect UNIQUE(set_id, psn_trophy_id).
  for (const r of reassigned) st.push({ sql: "UPDATE trophies SET psn_trophy_id = ? WHERE id = ?", params: [-1 - r.psnId, r.id] });
  // Unmatched local rows that would collide with a reassigned ID are moved out of the way.
  const takenIds = new Set(defs.trophies.map((d) => d.trophyId));
  for (const l of locals) {
    if (!used.has(l.id as string) && takenIds.has(l.psn_trophy_id as number)) {
      st.push({ sql: "UPDATE trophies SET psn_trophy_id = ? WHERE id = ?", params: [100000 + (l.psn_trophy_id as number), l.id as string] });
      warnings.push(`Local trophy "${l.name}" does not exist on the PSN list and was kept aside.`);
    }
  }
  for (const r of reassigned) st.push({ sql: "UPDATE trophies SET psn_trophy_id = ? WHERE id = ?", params: [r.psnId, r.id] });

  for (const d of defs.trophies) {
    const groupKey = groupKeyByPsn.get(d.trophyGroupId) ?? (d.trophyGroupId === "default" ? "default" : `psn-${d.trophyGroupId}`);
    if (!groupKeyByPsn.has(d.trophyGroupId)) {
      groupKeyByPsn.set(d.trophyGroupId, groupKey);
      st.push({
        sql: `INSERT OR IGNORE INTO trophy_groups (set_id, group_key, psn_group_id, name, required_for_platinum, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        params: [setId, groupKey, d.trophyGroupId, d.trophyGroupId === "default" ? "Base Game" : `Add-on ${d.trophyGroupId}`, d.trophyGroupId === "default" ? 1 : 0, order++],
      });
    }
    const localId = mapping.get(d.trophyId);
    if (localId) {
      st.push({
        sql: `UPDATE trophies SET name = COALESCE(?, name), description = COALESCE(?, description), grade = ?, hidden = ?,
                icon_url = COALESCE(?, icon_url), group_key = ?, facts_source = 'psn', facts_verified_at = ? WHERE id = ?`,
        params: [d.trophyName ?? null, d.trophyDetail ?? null, d.trophyType, d.trophyHidden ? 1 : 0, d.trophyIconUrl ?? null, groupKey, now, localId],
      });
    } else {
      const id = trophyIdFor(setId, d.trophyId) + (locals.some((l) => l.id === trophyIdFor(setId, d.trophyId)) ? `-psn` : "");
      mapping.set(d.trophyId, id);
      st.push({
        sql: `INSERT INTO trophies (id, set_id, game_id, psn_trophy_id, group_key, name, description, grade, hidden, icon_url,
                facts_source, facts_verified_at, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'psn', ?, ?)`,
        params: [
          id,
          setId,
          gameId,
          d.trophyId,
          groupKey,
          d.trophyName ?? `Hidden trophy #${d.trophyId}`,
          d.trophyDetail ?? "",
          d.trophyType,
          d.trophyHidden ? 1 : 0,
          d.trophyIconUrl ?? null,
          now,
          d.trophyId,
        ],
      });
    }
  }

  // Statuses.
  const prev = new Map(
    (await db.select<Row>("SELECT s.trophy_id, s.psn_state FROM trophy_status s JOIN trophies t ON t.id = s.trophy_id WHERE t.set_id = ?", [setId])).map(
      (r) => [r.trophy_id as string, (r.psn_state as string) ?? null],
    ),
  );
  const nameById = new Map(locals.map((l) => [l.id as string, l.name as string]));
  for (const d of defs.trophies) if (d.trophyName) nameById.set(mapping.get(d.trophyId)!, d.trophyName);
  const newlyEarned: string[] = [];
  let importedEarned = 0;
  let changes = 0;
  for (const e of earned.trophies) {
    const localId = mapping.get(e.trophyId);
    if (!localId) {
      warnings.push(`PSN reported status for unknown trophy #${e.trophyId}; ignored.`);
      continue;
    }
    const state = e.earned ? "earned" : "locked";
    const before = prev.get(localId) ?? null;
    st.push({
      sql: `INSERT INTO trophy_status (trophy_id, psn_state, psn_earned_at, psn_confirmed_at, psn_progress, psn_progress_target)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(trophy_id) DO UPDATE SET psn_state = excluded.psn_state, psn_earned_at = excluded.psn_earned_at,
              psn_confirmed_at = excluded.psn_confirmed_at, psn_progress = excluded.psn_progress, psn_progress_target = excluded.psn_progress_target`,
      params: [
        localId,
        state,
        e.earned ? (e.earnedDateTime ?? null) : null,
        now,
        e.progress === null || e.progress === undefined ? null : String(e.progress),
        e.trophyProgressTargetValue === null || e.trophyProgressTargetValue === undefined ? null : String(e.trophyProgressTargetValue),
      ],
    });
    st.push({
      sql: "UPDATE trophies SET psn_earned_rate = ?, psn_rarity = ? WHERE id = ?",
      params: [e.trophyEarnedRate, e.trophyRare ?? null, localId],
    });
    if (before !== state) {
      changes++;
      if (state === "earned" || before !== null) {
        st.push({
          sql: `INSERT INTO status_events (trophy_id, at, source, from_state, to_state, earned_at, session_id) VALUES (?, ?, 'psn', ?, ?, ?, NULL)`,
          params: [localId, now, before, state, e.earned ? (e.earnedDateTime ?? null) : null],
        });
      }
      if (state === "earned") {
        if (before === "locked") newlyEarned.push(nameById.get(localId) ?? `#${e.trophyId}`);
        else importedEarned++;
        st.push({ sql: "DELETE FROM recommendation_skips WHERE trophy_id = ?", params: [localId] });
      }
    }
  }

  const existingNotes = (set.dataset_notes as string) ?? "";
  const verifiedNote = `Verified against PSN (${set.np_communication_id}, ${set.np_service_name}) on ${now.slice(0, 10)}: ${defs.trophies.length} trophies.`;
  st.push({
    sql: `UPDATE trophy_sets SET ids_verified = 1, trophy_set_version = COALESCE(?, trophy_set_version), dataset_completeness = 'complete',
            dataset_notes = ? WHERE id = ?`,
    params: [defs.trophySetVersion ?? earned.trophySetVersion ?? null, `${verifiedNote}\n${existingNotes.replace(/^Verified against PSN[^\n]*\n?/, "")}`.trim(), setId],
  });
  st.push({
    sql: `INSERT INTO sync_state (set_id, status, last_attempt_at, last_success_at, last_error, last_error_at) VALUES (?, 'ok', ?, ?, NULL, NULL)
          ON CONFLICT(set_id) DO UPDATE SET status = 'ok', last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
            last_error = NULL, last_error_at = NULL`,
    params: [setId, startedAt, now],
  });
  st.push({ sql: "UPDATE games SET updated_at = ? WHERE id = ?", params: [now, gameId] });

  await db.batch(st);

  const earnedCount = earned.trophies.filter((t) => t.earned).length;
  const message =
    `Synced ${defs.trophies.length} trophies: ${earnedCount} earned on PSN` +
    (newlyEarned.length ? `, ${newlyEarned.length} newly earned` : "") +
    (warnings.length ? ` (${warnings.length} note${warnings.length === 1 ? "" : "s"})` : "");
  return { ok: true, setId, message, newlyEarned, importedEarned, changes, warnings, finishedAt: now };
}

/** Syncs every linked set, sequentially (rate-limit friendly). */
export async function syncAllBound(db: SqlDriver, gateway: PsnGateway): Promise<SyncResult[]> {
  const sets = await db.select<{ id: string }>(
    "SELECT s.id FROM trophy_sets s JOIN games g ON g.id = s.game_id WHERE s.binding_status = 'bound' AND g.is_sample = 0",
  );
  const out: SyncResult[] = [];
  for (const s of sets) out.push(await syncSet(db, gateway, s.id));
  return out;
}

export async function syncLog(db: SqlDriver, limit = 20) {
  return db.select<{ id: number; set_id: string | null; started_at: string; finished_at: string; ok: number; message: string; changes: number }>(
    "SELECT * FROM sync_log ORDER BY id DESC LIMIT ?",
    [limit],
  );
}

