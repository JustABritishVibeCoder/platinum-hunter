/**
 * Schema for curated trophy datasets ("catalogs").
 *
 * A catalog bundles authoritative trophy FACTS (with their source and retrieval date)
 * and separately-labelled GUIDANCE (editorial/community estimates and walkthrough
 * summaries). The same schema is used for bundled catalogs and for user imports, so
 * every catalog is validated before it touches the database.
 */
import { z } from "zod";

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "Guide and source links must use https");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const prereqSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("story"), checkpoint: z.string().min(1) }),
  z.object({ type: z.literal("trophy"), psnTrophyId: z.number().int().min(0) }),
  z.object({ type: z.literal("flag"), flag: z.string().min(1) }),
  z.object({ type: z.literal("counterAtLeast"), counter: z.string().min(1), value: z.number().min(0) }),
  z.object({ type: z.literal("characterAvailable"), character: z.enum(["michael", "franklin", "trevor"]) }),
]);

export const guidanceSchema = z.object({
  category: z.enum(["story", "collectible", "side_activity", "challenge", "completion", "gold_medals", "online", "creator", "misc"]),
  gameMode: z.enum(["single_player", "online", "creator"]),
  character: z.enum(["michael", "franklin", "trevor", "any"]).nullable().default(null),
  difficulty: z.number().min(1).max(10).nullable(),
  minutes: z.number().int().min(1).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  estimateBasis: z.string().nullable().default(null),
  passive: z.boolean().default(false),
  onlineRequired: z.boolean(),
  multiplayer: z.enum(["none", "optional", "required"]),
  missable: z
    .object({
      risk: z.enum(["conditional", "high"]),
      note: z.string().min(1),
      closesAfter: z.string().optional(),
      warnFrom: z.string().optional(),
      sourceUrl: httpsUrl,
    })
    .nullable()
    .default(null),
  prereqs: z.array(prereqSchema).default([]),
  softPrereqs: z.array(prereqSchema).default([]),
  related: z.array(z.number().int().min(0)).default([]),
  phase: z.string().nullable().default(null),
  storyCheckpoint: z.string().nullable().default(null),
  counter: z.object({ key: z.string(), target: z.number().positive() }).nullable().default(null),
  summary: z.string().min(1),
  steps: z.array(z.string().min(1)).default([]),
  guides: z.array(z.object({ label: z.string().min(1), url: httpsUrl })).default([]),
});

export const catalogTrophySchema = z.object({
  psnTrophyId: z.number().int().min(0),
  groupKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  grade: z.enum(["bronze", "silver", "gold", "platinum"]),
  hidden: z.boolean().default(false),
  communityEarnedRate: z.number().min(0).max(100).nullable().default(null),
  guidance: guidanceSchema.nullable().default(null),
});

export const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogId: z.string().regex(/^[a-z0-9-]+$/),
    game: z.object({
      title: z.string().min(1),
      platform: z.enum(["PS5", "PS4", "PS3", "PSVITA", "PSVR", "PSVR2", "PC"]),
      edition: z.string().min(1),
      region: z.string().nullable().default(null),
    }),
    trophySet: z.object({
      npServiceName: z.enum(["trophy", "trophy2"]),
      npCommunicationId: z.string().regex(/^NPWR\d{5}_00$/).nullable(),
      npTitleIds: z.array(z.string().regex(/^[A-Z]{4}\d{5}_00$/)).default([]),
      expectedCounts: z.object({
        platinum: z.number().int().min(0).max(1),
        gold: z.number().int().min(0),
        silver: z.number().int().min(0),
        bronze: z.number().int().min(0),
      }),
      idsVerified: z.boolean(),
      dataset: z.object({
        source: z.string().min(1),
        sourceUrl: httpsUrl,
        retrievedAt: isoDate,
        completeness: z.enum(["complete", "partial"]),
        notes: z.string().default(""),
      }),
    }),
    groups: z
      .array(
        z.object({
          key: z.string().min(1),
          psnGroupId: z.string().nullable(),
          name: z.string().min(1),
          requiredForPlatinum: z.boolean(),
        }),
      )
      .min(1),
    estimates: z.object({
      source: z.string().min(1),
      date: isoDate,
      methodology: z.string().min(1),
      communityRateSource: z.string().nullable().default(null),
    }),
    story: z
      .object({
        checkpoints: z.array(z.object({ id: z.string(), name: z.string(), index: z.number().int().min(0), note: z.string().optional() })),
        minutesPerMission: z.number().positive(),
        totalMissions: z.number().int().positive(),
        orderNote: z.string(),
        endings: z
          .object({
            question: z.string(),
            options: z.array(z.object({ id: z.enum(["A", "B", "C"]), label: z.string(), removes: z.array(z.enum(["michael", "franklin", "trevor"])) })),
          })
          .nullable()
          .default(null),
      })
      .nullable()
      .default(null),
    flags: z.array(z.object({ id: z.string(), question: z.string(), help: z.string() })).default([]),
    counters: z.array(z.object({ key: z.string(), label: z.string(), max: z.number().positive(), unit: z.string().optional() })).default([]),
    rankModel: z
      .object({
        counter: z.string(),
        anchors: z.array(z.object({ rank: z.number().int(), rp: z.number().int() })).min(2),
        rpPerHour: z.number().positive(),
        source: z.string(),
      })
      .nullable()
      .default(null),
    phases: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })).default([]),
    trophies: z.array(catalogTrophySchema).min(1),
  })
  .superRefine((cat, ctx) => {
    const ids = new Set<number>();
    const groupKeys = new Set(cat.groups.map((g) => g.key));
    const checkpoints = new Set(cat.story?.checkpoints.map((c) => c.id) ?? []);
    const flags = new Set(cat.flags.map((f) => f.id));
    const counters = new Set(cat.counters.map((c) => c.key));
    const phases = new Set(cat.phases.map((p) => p.id));
    for (const t of cat.trophies) {
      if (ids.has(t.psnTrophyId)) ctx.addIssue({ code: "custom", message: `Duplicate trophy id ${t.psnTrophyId}` });
      ids.add(t.psnTrophyId);
      if (!groupKeys.has(t.groupKey)) ctx.addIssue({ code: "custom", message: `Trophy ${t.name} references unknown group ${t.groupKey}` });
    }
    for (const t of cat.trophies) {
      const g = t.guidance;
      if (!g) continue;
      const refs = [...g.prereqs, ...g.softPrereqs];
      for (const p of refs) {
        if (p.type === "trophy" && !ids.has(p.psnTrophyId)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown trophy prereq ${p.psnTrophyId}` });
        if (p.type === "story" && !checkpoints.has(p.checkpoint)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown checkpoint ${p.checkpoint}` });
        if (p.type === "flag" && !flags.has(p.flag)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown flag ${p.flag}` });
        if (p.type === "counterAtLeast" && !counters.has(p.counter)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown counter ${p.counter}` });
      }
      if (g.storyCheckpoint && !checkpoints.has(g.storyCheckpoint)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown storyCheckpoint` });
      if (g.counter && !counters.has(g.counter.key)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown counter ${g.counter.key}` });
      if (g.phase && !phases.has(g.phase)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown phase ${g.phase}` });
      for (const cp of [g.missable?.closesAfter, g.missable?.warnFrom]) {
        if (cp && !checkpoints.has(cp)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown missable checkpoint ${cp}` });
      }
      for (const r of g.related) if (!ids.has(r)) ctx.addIssue({ code: "custom", message: `${t.name}: unknown related trophy ${r}` });
    }
    const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const t of cat.trophies) counts[t.grade]++;
    const e = cat.trophySet.expectedCounts;
    if (cat.trophySet.dataset.completeness === "complete") {
      for (const grade of ["platinum", "gold", "silver", "bronze"] as const) {
        if (counts[grade] !== e[grade]) {
          ctx.addIssue({ code: "custom", message: `Dataset marked complete but has ${counts[grade]} ${grade} trophies; expected ${e[grade]}` });
        }
      }
    }
  });

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogTrophy = z.infer<typeof catalogTrophySchema>;
export type CatalogGuidance = z.infer<typeof guidanceSchema>;

export function parseCatalog(input: unknown): { ok: true; catalog: Catalog } | { ok: false; errors: string[] } {
  const result = catalogSchema.safeParse(input);
  if (result.success) return { ok: true, catalog: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 25).map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`),
  };
}
