import { z } from "zod";
import type { SqlDriver } from "../driver";
import { selectOne } from "../driver";
import { nowIso, parseJson } from "../util";

export const settingsSchema = z.object({
  theme: z.enum(["ps5", "midnight", "graphite", "oled"]).default("ps5"),
  /** Name shown in "Welcome back, …". null until the user has seen the welcome screen. */
  displayName: z.string().max(40).nullable().default(null),
  accent: z.enum(["violet", "indigo", "orchid", "ice"]).default("violet"),
  defaultMode: z.enum(["easiest", "quickest", "best_progress"]).default("best_progress"),
  defaultPlatform: z.enum(["PS5", "PS4", "PS3", "PSVITA", "PSVR", "PSVR2", "PC"]).default("PS5"),
  includeOptionalTrophies: z.boolean().default(false),
  syncOnLaunch: z.boolean().default(true),
  syncOnSessionEnd: z.boolean().default(true),
  autoSyncMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).default(0),
  staleHours: z.number().min(1).max(24 * 30).default(24),
  skipHours: z.number().min(1).max(24 * 30).default(24),
  notifications: z
    .object({
      trophyEarned: z.boolean().default(true),
      syncErrors: z.boolean().default(true),
      missableWarnings: z.boolean().default(true),
    })
    .default({ trophyEarned: true, syncErrors: true, missableWarnings: true }),
  sessionTimer: z
    .object({
      showSeconds: z.boolean().default(true),
      confirmEnd: z.boolean().default(true),
    })
    .default({ showSeconds: true, confirmEnd: true }),
  discord: z
    .object({
      enabled: z.boolean().default(false),
      applicationId: z.string().regex(/^(\d{15,21})?$/).default(""),
      showProgress: z.boolean().default(true),
      showNextTrophy: z.boolean().default(true),
      showWhenIdle: z.boolean().default(false),
    })
    .default({ enabled: false, applicationId: "", showProgress: true, showNextTrophy: true, showWhenIdle: false }),
  psn: z
    .object({
      /** Explicit opt-in to the unofficial PSN sync. Off by default. */
      optIn: z.boolean().default(false),
      riskAcknowledgedAt: z.string().nullable().default(null),
    })
    .default({ optIn: false, riskAcknowledgedAt: null }),
  showSampleData: z.boolean().default(false),
  onboardingDismissed: z.boolean().default(false),
  lastGameId: z.string().nullable().default(null),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export async function loadSettings(db: SqlDriver): Promise<Settings> {
  const row = await selectOne<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'app'");
  const parsed = settingsSchema.safeParse(parseJson(row?.value, {}));
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: SqlDriver, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(db);
  const next = settingsSchema.parse({ ...current, ...patch });
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(next), nowIso()],
  );
  return next;
}
