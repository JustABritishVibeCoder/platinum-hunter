/**
 * The connected account's public profile (online ID, avatar, PS Plus, trophy level).
 * Read-only. Cached in `app_meta` so it shows offline; app_meta is never included in
 * data exports, and the cache is cleared on disconnect.
 */
import { z } from "zod";
import type { SqlDriver } from "../db/driver";
import { selectOne } from "../db/driver";
import { parseJson } from "../db/util";

const counts = z.object({
  bronze: z.number().int().min(0),
  silver: z.number().int().min(0),
  gold: z.number().int().min(0),
  platinum: z.number().int().min(0),
});

const responseSchema = z.object({
  summary: z.object({
    accountId: z.string().regex(/^\d{1,20}$/),
    trophyLevel: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().int().min(1).max(999)),
    progress: z.number().min(0).max(100).optional().default(0),
    tier: z.number().int().min(1).max(10).optional(),
    earnedTrophies: counts,
  }),
  profile: z.object({
    onlineId: z.string().min(1).max(32),
    avatars: z.array(z.object({ size: z.string(), url: z.string().url() })).default([]),
    isPlus: z.boolean().optional().default(false),
  }),
});

export interface PsnProfile {
  onlineId: string;
  avatarUrl: string | null;
  isPlus: boolean;
  trophyLevel: number;
  tier: number;
  levelProgress: number;
  earned: z.infer<typeof counts>;
  fetchedAt: string;
}

const SIZE_RANK: Record<string, number> = { xl: 4, l: 3, m: 2, s: 1 };

/** Avatars are served from PlayStation hosts, sometimes over http; use https only. */
function safeAvatar(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(".playstation.net") && !u.hostname.endsWith(".playstation.com")) return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

/** Tier from level, per Sony's 2020 trophy level bands (1-99 = tier 1 … 999 = tier 10). */
export function tierForLevel(level: number): number {
  if (level >= 999) return 10;
  if (level >= 800) return 9;
  return Math.min(9, Math.floor(level / 100) + 1);
}

export function tierGrade(tier: number): "bronze" | "silver" | "gold" | "platinum" {
  return tier >= 10 ? "platinum" : tier >= 7 ? "gold" : tier >= 4 ? "silver" : "bronze";
}

export function parseProfile(raw: unknown, now: Date = new Date()): PsnProfile {
  const r = responseSchema.safeParse(raw);
  if (!r.success) throw new Error("PSN returned your profile in an unexpected format.");
  const { summary, profile } = r.data;
  const avatar = [...profile.avatars].sort((a, b) => (SIZE_RANK[b.size] ?? 0) - (SIZE_RANK[a.size] ?? 0))[0];
  return {
    onlineId: profile.onlineId,
    avatarUrl: safeAvatar(avatar?.url),
    isPlus: profile.isPlus,
    trophyLevel: summary.trophyLevel,
    tier: summary.tier ?? tierForLevel(summary.trophyLevel),
    levelProgress: summary.progress,
    earned: summary.earnedTrophies,
    fetchedAt: now.toISOString(),
  };
}

const KEY = "psn_profile";

export async function saveProfile(db: SqlDriver, p: PsnProfile): Promise<void> {
  await db.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [KEY, JSON.stringify(p)]);
}

export async function loadProfile(db: SqlDriver): Promise<PsnProfile | null> {
  const row = await selectOne<{ value: string }>(db, "SELECT value FROM app_meta WHERE key = ?", [KEY]);
  const p = parseJson<PsnProfile | null>(row?.value, null);
  return p && typeof p.onlineId === "string" ? p : null;
}

export async function clearProfile(db: SqlDriver): Promise<void> {
  await db.execute("DELETE FROM app_meta WHERE key = ?", [KEY]);
}
