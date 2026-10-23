/**
 * Validation for PSN trophy API responses. Everything from the network is untrusted:
 * unknown fields are dropped, required fields are checked, and a response that does
 * not validate fails the sync instead of being partially applied.
 */
import { z } from "zod";

const counts = z.object({
  bronze: z.number().int().min(0),
  silver: z.number().int().min(0),
  gold: z.number().int().min(0),
  platinum: z.number().int().min(0).max(1),
});

const grade = z.enum(["bronze", "silver", "gold", "platinum"]);
const npId = z.string().regex(/^NPWR\d{5}_00$/);
const httpsImage = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"))
  .optional()
  .nullable();

export const trophyTitleSchema = z.object({
  npServiceName: z.enum(["trophy", "trophy2"]),
  npCommunicationId: npId,
  trophySetVersion: z.string().max(32).optional().nullable(),
  trophyTitleName: z.string().min(1).max(300),
  trophyTitleIconUrl: httpsImage,
  trophyTitlePlatform: z.string().min(1).max(64),
  hasTrophyGroups: z.boolean().optional(),
  definedTrophies: counts,
  earnedTrophies: counts.optional(),
  progress: z.number().min(0).max(100).optional(),
  lastUpdatedDateTime: z.string().optional(),
});
export type PsnTrophyTitle = z.infer<typeof trophyTitleSchema>;

export const titleTrophySchema = z.object({
  trophyId: z.number().int().min(0).max(10000),
  trophyHidden: z.boolean().optional().default(false),
  trophyType: grade,
  trophyName: z.string().max(300).optional().nullable(),
  trophyDetail: z.string().max(2000).optional().nullable(),
  trophyIconUrl: httpsImage,
  trophyGroupId: z.string().max(16).optional().default("default"),
});

export const titleTrophiesResponseSchema = z.object({
  trophySetVersion: z.string().max(32).optional().nullable(),
  trophies: z.array(titleTrophySchema).max(5000),
});
export type PsnTitleTrophies = z.infer<typeof titleTrophiesResponseSchema>;

export const trophyGroupsResponseSchema = z.object({
  trophyGroups: z
    .array(
      z.object({
        trophyGroupId: z.string().max(16),
        trophyGroupName: z.string().max(300).optional().nullable(),
        definedTrophies: counts.optional(),
      }),
    )
    .max(200)
    .default([]),
});
export type PsnTrophyGroups = z.infer<typeof trophyGroupsResponseSchema>;

const rate = z.union([z.string(), z.number()]).optional().nullable().transform((v) => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
});

export const earnedTrophySchema = z.object({
  trophyId: z.number().int().min(0).max(10000),
  trophyHidden: z.boolean().optional(),
  earned: z.boolean(),
  earnedDateTime: z.string().datetime({ offset: true }).optional().nullable(),
  trophyType: grade.optional(),
  trophyRare: z.number().int().min(0).max(3).optional().nullable(),
  trophyEarnedRate: rate,
  progress: z.union([z.string(), z.number()]).optional().nullable(),
  trophyProgressTargetValue: z.union([z.string(), z.number()]).optional().nullable(),
});

export const userEarnedResponseSchema = z.object({
  trophySetVersion: z.string().max(32).optional().nullable(),
  lastUpdatedDateTime: z.string().optional().nullable(),
  trophies: z.array(earnedTrophySchema).max(5000),
});
export type PsnUserEarned = z.infer<typeof userEarnedResponseSchema>;

export function validate<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new PsnValidationError(
      `PSN returned ${what} in an unexpected format (${first?.path.join(".") || "root"}: ${first?.message}). Nothing was changed.`,
    );
  }
  return r.data;
}

export class PsnValidationError extends Error {}

/** Parses a trophy-title list, keeping valid entries and counting rejected ones. */
export function parseTitles(raw: unknown[]): { titles: PsnTrophyTitle[]; rejected: number } {
  const titles: PsnTrophyTitle[] = [];
  let rejected = 0;
  for (const item of raw) {
    const r = trophyTitleSchema.safeParse(item);
    if (r.success) titles.push(r.data);
    else rejected++;
  }
  return { titles, rejected };
}
