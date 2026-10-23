/** Shared test fixtures. All data here is MOCK data for automated tests only. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCatalog } from "../catalog";
import { installCatalog } from "../db/repo/catalogImport";
import { loadBundle } from "../db/repo/games";
import { migrate } from "../db/migrations";
import type { PsnGateway } from "../psn/gateway";
import { openNodeDriver, type NodeDriver } from "./nodeDriver";

export const GTA_ID = "gta-v-ps5";
export const GTA_SET = "gta-v-ps5:set";
export const tid = (psnId: number) => `${GTA_SET}#${psnId}`;

export async function freshDb(path?: string): Promise<NodeDriver> {
  const db = openNodeDriver(path);
  await migrate(db);
  return db;
}

export async function gtaDb(path?: string): Promise<NodeDriver> {
  const db = await freshDb(path);
  await installCatalog(db, findCatalog(GTA_ID)!);
  return db;
}

export async function gtaBundle(db: NodeDriver, now = new Date()) {
  const b = await loadBundle(db, GTA_ID, { now });
  if (!b) throw new Error("bundle missing");
  return b;
}

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ph-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** MOCK PSN trophy-title entries (shape per community API docs). Not real account data. */
export const MOCK_PS5_TITLE = {
  npServiceName: "trophy2",
  npCommunicationId: "NPWR99990_00",
  trophySetVersion: "01.10",
  trophyTitleName: "Grand Theft Auto V",
  trophyTitleIconUrl: "https://image.api.playstation.com/mock/ps5.png",
  trophyTitlePlatform: "PS5",
  hasTrophyGroups: true,
  definedTrophies: { bronze: 59, silver: 15, gold: 3, platinum: 1 },
  earnedTrophies: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
  progress: 2,
  lastUpdatedDateTime: "2026-10-01T10:00:00Z",
};
export const MOCK_PS4_TITLE = {
  ...MOCK_PS5_TITLE,
  npServiceName: "trophy",
  npCommunicationId: "NPWR99991_00",
  trophyTitlePlatform: "PS4",
  trophyTitleIconUrl: "https://image.api.playstation.com/mock/ps4.png",
};

/** Builds MOCK definitions/earned responses from the bundled catalog. */
export function mockResponses(earnedIds: Record<number, string> = {}) {
  const cat = findCatalog(GTA_ID)!;
  const groupId: Record<string, string> = { default: "default", heists: "001", "rockstar-editor": "002", doomsday: "003" };
  return {
    defs: {
      trophySetVersion: "01.10",
      hasTrophyGroups: true,
      totalItemCount: cat.trophies.length,
      trophies: cat.trophies.map((t) => ({
        trophyId: t.psnTrophyId,
        trophyHidden: false,
        trophyType: t.grade,
        trophyName: t.name,
        trophyDetail: t.description,
        trophyIconUrl: `https://image.api.playstation.com/mock/${t.psnTrophyId}.png`,
        trophyGroupId: groupId[t.groupKey],
      })),
    },
    groups: {
      trophyGroups: [
        { trophyGroupId: "default", trophyGroupName: "Grand Theft Auto V" },
        { trophyGroupId: "001", trophyGroupName: "Grand Theft Auto Online: Heists" },
        { trophyGroupId: "002", trophyGroupName: "Rockstar Editor" },
        { trophyGroupId: "003", trophyGroupName: "Grand Theft Auto Online: The Doomsday Heist" },
      ],
    },
    earned: {
      trophySetVersion: "01.10",
      lastUpdatedDateTime: "2026-10-01T10:00:00Z",
      totalItemCount: cat.trophies.length,
      trophies: cat.trophies.map((t) => ({
        trophyId: t.psnTrophyId,
        trophyHidden: false,
        earned: t.psnTrophyId in earnedIds,
        ...(t.psnTrophyId in earnedIds ? { earnedDateTime: earnedIds[t.psnTrophyId] } : {}),
        trophyType: t.grade,
        trophyRare: 3,
        trophyEarnedRate: "12.5",
      })),
    },
  };
}

export function mockGateway(over: Partial<PsnGateway> & { responses?: ReturnType<typeof mockResponses> } = {}): PsnGateway {
  const r = over.responses ?? mockResponses();
  return {
    status: async () => ({ connected: true, needsReauth: false, connectedAt: 1, refreshExpiresAt: 9_999_999_999 }),
    connect: async () => ({ connected: true, needsReauth: false, connectedAt: 1, refreshExpiresAt: 9_999_999_999 }),
    disconnect: async () => undefined,
    ownProfile: async () => ({}),
    userTitles: async () => [MOCK_PS4_TITLE, MOCK_PS5_TITLE],
    titleTrophies: async () => r.defs,
    titleTrophyGroups: async () => r.groups,
    userEarned: async () => r.earned,
    ...over,
  };
}
