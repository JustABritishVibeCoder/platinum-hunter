/**
 * Installs a validated catalog into the database. Idempotent: re-installing refreshes
 * guidance and metadata, but never overwrites facts that PSN has since verified and
 * never touches the player's statuses, sessions or answers.
 */
import type { Catalog } from "../../catalog/schema";
import type { GameMeta } from "../../domain/bundle";
import type { SqlDriver, SqlStatement } from "../driver";
import { nowIso } from "../util";

export const setIdFor = (gameId: string) => `${gameId}:set`;
export const trophyIdFor = (setId: string, psnTrophyId: number) => `${setId}#${psnTrophyId}`;

export function normaliseName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

export function catalogMeta(c: Catalog): GameMeta {
  return {
    story: c.story,
    flags: c.flags,
    counters: c.counters,
    rankModel: c.rankModel,
    phases: c.phases,
    estimates: c.estimates,
  };
}

export async function installCatalog(db: SqlDriver, c: Catalog, now: Date = new Date()): Promise<string> {
  const gameId = c.catalogId;
  const setId = setIdFor(gameId);
  const ts = nowIso(now);
  const existing = await db.select<{ id: string }>("SELECT id FROM games WHERE id = ?", [gameId]);
  const existingTrophies = await db.select<{ id: string; psn_trophy_id: number; name: string; facts_source: string }>(
    "SELECT id, psn_trophy_id, name, facts_source FROM trophies WHERE set_id = ?",
    [setId],
  );
  const byName = new Map(existingTrophies.map((r) => [normaliseName(r.name), r]));
  const byPsnId = new Map(existingTrophies.map((r) => [r.psn_trophy_id, r]));
  const st: SqlStatement[] = [];

  if (existing.length === 0) {
    st.push({
      sql: `INSERT INTO games (id, title, platform, edition, region, cover_url, source, is_sample, catalog_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, 'catalog', 0, ?, ?, ?)`,
      params: [gameId, c.game.title, c.game.platform, c.game.edition, c.game.region, c.catalogId, ts, ts],
    });
    st.push({
      sql: `INSERT INTO trophy_sets (id, game_id, platform, np_communication_id, np_service_name, np_title_ids, binding_status,
              dataset_source, dataset_source_url, dataset_retrieved_at, dataset_completeness, dataset_notes, ids_verified)
            VALUES (?, ?, ?, ?, ?, ?, 'unbound', ?, ?, ?, ?, ?, 0)`,
      params: [
        setId,
        gameId,
        c.game.platform,
        c.trophySet.npCommunicationId,
        c.trophySet.npServiceName,
        JSON.stringify(c.trophySet.npTitleIds),
        c.trophySet.dataset.source,
        c.trophySet.dataset.sourceUrl,
        c.trophySet.dataset.retrievedAt,
        c.trophySet.dataset.completeness,
        c.trophySet.dataset.notes,
      ],
    });
    st.push({ sql: "INSERT INTO sync_state (set_id, status) VALUES (?, 'never')", params: [setId] });
  } else {
    st.push({
      sql: `UPDATE trophy_sets SET dataset_source = ?, dataset_source_url = ?, dataset_retrieved_at = ?, dataset_completeness = ?,
              dataset_notes = ?, np_title_ids = ? WHERE id = ?`,
      params: [
        c.trophySet.dataset.source,
        c.trophySet.dataset.sourceUrl,
        c.trophySet.dataset.retrievedAt,
        c.trophySet.dataset.completeness,
        c.trophySet.dataset.notes,
        JSON.stringify(c.trophySet.npTitleIds),
        setId,
      ],
    });
  }

  st.push({ sql: "INSERT OR REPLACE INTO game_meta (game_id, data) VALUES (?, ?)", params: [gameId, JSON.stringify(catalogMeta(c))] });

  c.groups.forEach((g, i) => {
    st.push({
      sql: `INSERT INTO trophy_groups (set_id, group_key, psn_group_id, name, required_for_platinum, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(set_id, group_key) DO UPDATE SET required_for_platinum = excluded.required_for_platinum, sort_order = excluded.sort_order`,
      params: [setId, g.key, g.psnGroupId, g.name, g.requiredForPlatinum ? 1 : 0, i],
    });
  });

  c.trophies.forEach((t, i) => {
    // Prefer matching by name: a PSN sync may have corrected the inferred trophy IDs.
    const match = byName.get(normaliseName(t.name)) ?? byPsnId.get(t.psnTrophyId);
    if (match && match.facts_source === "psn" && normaliseName(match.name) !== normaliseName(t.name)) {
      return; // PSN says this ID belongs to a different trophy; leave PSN's facts alone.
    }
    const id = match?.id ?? trophyIdFor(setId, t.psnTrophyId);
    if (!match) {
      st.push({
        sql: `INSERT INTO trophies (id, set_id, game_id, psn_trophy_id, group_key, name, description, grade, hidden, icon_url,
                facts_source, facts_verified_at, community_earned_rate, community_rate_source, community_rate_retrieved_at, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'catalog', NULL, ?, ?, ?, ?)`,
        params: [
          id,
          setId,
          gameId,
          t.psnTrophyId,
          t.groupKey,
          t.name,
          t.description,
          t.grade,
          t.hidden ? 1 : 0,
          t.communityEarnedRate,
          c.estimates.communityRateSource,
          c.trophySet.dataset.retrievedAt,
          i,
        ],
      });
    } else {
      st.push({
        sql: `UPDATE trophies SET community_earned_rate = ?, community_rate_source = ?, community_rate_retrieved_at = ? WHERE id = ?`,
        params: [t.communityEarnedRate, c.estimates.communityRateSource, c.trophySet.dataset.retrievedAt, id],
      });
      if (match.facts_source !== "psn") {
        st.push({
          sql: "UPDATE trophies SET name = ?, description = ?, grade = ?, group_key = ? WHERE id = ?",
          params: [t.name, t.description, t.grade, t.groupKey, id],
        });
      }
    }
    if (t.guidance) {
      const g = t.guidance;
      st.push({
        sql: `INSERT OR REPLACE INTO trophy_guidance (trophy_id, category, game_mode, difficulty, minutes, missable, online_required,
                multiplayer, phase, data, source, source_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          g.category,
          g.gameMode,
          g.difficulty,
          g.minutes,
          g.missable ? 1 : 0,
          g.onlineRequired ? 1 : 0,
          g.multiplayer,
          g.phase,
          JSON.stringify(g),
          c.estimates.source,
          c.estimates.date,
        ],
      });
    }
  });

  await db.batch(st);
  return gameId;
}
