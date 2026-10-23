/**
 * Optional SAMPLE data for exploring the interface. It uses a fictional game, is flagged
 * `is_sample = 1` everywhere, is excluded from statistics and dashboards, is labelled
 * "SAMPLE" in the UI, and can be removed in one click. It is never mixed with real data.
 */
import type { SqlDriver, SqlStatement } from "../driver";
import { nowIso } from "../util";

export const SAMPLE_GAME_ID = "sample-game";

export async function hasSampleData(db: SqlDriver): Promise<boolean> {
  return (await db.select("SELECT 1 FROM games WHERE is_sample = 1 LIMIT 1")).length > 0;
}

export async function removeSampleData(db: SqlDriver): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM sessions WHERE is_sample = 1" },
    { sql: "DELETE FROM games WHERE is_sample = 1" },
  ]);
}

export async function installSampleData(db: SqlDriver, now: Date = new Date()): Promise<void> {
  if (await hasSampleData(db)) return;
  const setId = `${SAMPLE_GAME_ID}:set`;
  const ts = nowIso(now);
  const day = 86_400_000;
  const trophies: [string, string, "bronze" | "silver" | "gold" | "platinum", number, number][] = [
    ["Sample Platinum", "Earn every other sample trophy.", "platinum", 5, 600],
    ["First Steps", "Finish the sample tutorial.", "bronze", 1, 15],
    ["Collector", "Find 20 sample relics.", "bronze", 3, 90],
    ["Sharp Shooter", "Win a sample shooting challenge.", "silver", 4, 45],
    ["Night Owl", "Play the sample game after midnight.", "bronze", 1, 10],
    ["Grand Finale", "Complete the sample story.", "gold", 3, 300],
  ];
  const st: SqlStatement[] = [
    {
      sql: `INSERT INTO games (id, title, platform, edition, region, cover_url, source, is_sample, catalog_id, created_at, updated_at)
            VALUES (?, 'Sample Game (demo data)', 'PS5', 'Sample edition', NULL, NULL, 'sample', 1, NULL, ?, ?)`,
      params: [SAMPLE_GAME_ID, ts, ts],
    },
    {
      sql: `INSERT INTO trophy_sets (id, game_id, platform, np_service_name, binding_status, dataset_source, dataset_completeness, dataset_notes)
            VALUES (?, ?, 'PS5', 'trophy2', 'unbound', 'Sample data', 'complete', 'Fictional demo data for exploring the app. Not real trophies.')`,
      params: [setId, SAMPLE_GAME_ID],
    },
    { sql: "INSERT INTO trophy_groups (set_id, group_key, psn_group_id, name, required_for_platinum, sort_order) VALUES (?, 'default', NULL, 'Sample', 1, 0)", params: [setId] },
    { sql: "INSERT INTO sync_state (set_id, status) VALUES (?, 'never')", params: [setId] },
  ];
  trophies.forEach(([name, desc, grade, diff, minutes], i) => {
    const id = `${setId}#${i}`;
    st.push({
      sql: `INSERT INTO trophies (id, set_id, game_id, psn_trophy_id, group_key, name, description, grade, hidden, facts_source, sort_order)
            VALUES (?, ?, ?, ?, 'default', ?, ?, ?, 0, 'sample', ?)`,
      params: [id, setId, SAMPLE_GAME_ID, i, name, desc, grade, i],
    });
    st.push({
      sql: `INSERT INTO trophy_guidance (trophy_id, category, game_mode, difficulty, minutes, missable, online_required, multiplayer, phase, data, source, source_date)
            VALUES (?, 'misc', 'single_player', ?, ?, 0, 0, 'none', NULL, ?, 'Sample data', NULL)`,
      params: [
        id,
        diff,
        minutes,
        JSON.stringify({
          category: "misc",
          gameMode: "single_player",
          difficulty: diff,
          minutes,
          confidence: "low",
          onlineRequired: false,
          multiplayer: "none",
          summary: `${desc} (sample guidance)`,
          steps: ["This is sample data for exploring the interface."],
          guides: [],
        }),
      ],
    });
  });
  st.push({
    sql: "INSERT INTO trophy_status (trophy_id, manual_state, manual_updated_at) VALUES (?, 'earned', ?), (?, 'earned', ?)",
    params: [`${setId}#1`, nowIso(new Date(now.getTime() - 2 * day)), `${setId}#4`, nowIso(new Date(now.getTime() - day))],
  });
  for (let i = 0; i < 3; i++) {
    const start = new Date(now.getTime() - (3 - i) * day);
    const end = new Date(start.getTime() + (45 + i * 30) * 60_000);
    const sid = `sample-session-${i}`;
    st.push({
      sql: "INSERT INTO sessions (id, game_id, started_at, ended_at, status, notes, is_sample) VALUES (?, ?, ?, ?, 'ended', 'Sample session', 1)",
      params: [sid, SAMPLE_GAME_ID, nowIso(start), nowIso(end)],
    });
    st.push({ sql: "INSERT INTO session_segments (session_id, started_at, ended_at) VALUES (?, ?, ?)", params: [sid, nowIso(start), nowIso(end)] });
  }
  await db.batch(st);
}
