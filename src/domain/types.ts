/**
 * Core domain types.
 *
 * The model deliberately keeps three kinds of information apart:
 *  1. Trophy FACTS (name, description, grade): authoritative, from PSN or a cited dataset.
 *  2. GUIDANCE (difficulty, time, steps, prerequisites): community/editorial estimates.
 *  3. STATUS (earned/locked): from PSN (verified) or from the user (manual), never mixed.
 */

export type Platform = "PS5" | "PS4" | "PS3" | "PSVITA" | "PSVR" | "PSVR2" | "PC";
export const PLATFORMS: Platform[] = ["PS5", "PS4", "PS3", "PSVITA", "PSVR", "PSVR2", "PC"];

export type Grade = "bronze" | "silver" | "gold" | "platinum";
export const GRADES: Grade[] = ["platinum", "gold", "silver", "bronze"];

export type NpServiceName = "trophy" | "trophy2";

/** Where a game record came from. `catalog` = curated dataset bundled with the app. */
export type GameSource = "catalog" | "psn" | "manual" | "sample";

/** Where a trophy's name/description came from. */
export type FactsSource = "psn" | "catalog" | "manual" | "sample";

export interface Game {
  id: string;
  title: string;
  platform: Platform;
  edition: string;
  region: string | null;
  coverUrl: string | null;
  source: GameSource;
  isSample: boolean;
  catalogId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrophySet {
  id: string;
  gameId: string;
  platform: Platform;
  npCommunicationId: string | null;
  npServiceName: NpServiceName | null;
  npTitleIds: string[];
  trophySetVersion: string | null;
  bindingStatus: "unbound" | "bound";
  datasetSource: string | null;
  datasetSourceUrl: string | null;
  datasetRetrievedAt: string | null;
  datasetCompleteness: "complete" | "partial" | "unknown";
  datasetNotes: string | null;
  idsVerified: boolean;
}

export interface TrophyGroup {
  setId: string;
  groupKey: string;
  psnGroupId: string | null;
  name: string;
  requiredForPlatinum: boolean;
  sortOrder: number;
}

export interface Trophy {
  id: string;
  setId: string;
  gameId: string;
  psnTrophyId: number;
  groupKey: string;
  name: string;
  description: string;
  grade: Grade;
  hidden: boolean;
  iconUrl: string | null;
  factsSource: FactsSource;
  factsVerifiedAt: string | null;
  psnEarnedRate: number | null;
  psnRarity: number | null;
  communityEarnedRate: number | null;
  communityRateSource: string | null;
  communityRateRetrievedAt: string | null;
  sortOrder: number;
}

export type Character = "michael" | "franklin" | "trevor";
export type Confidence = "low" | "medium" | "high";
export type Multiplayer = "none" | "optional" | "required";
export type TrophyCategory =
  | "story"
  | "collectible"
  | "side_activity"
  | "challenge"
  | "completion"
  | "gold_medals"
  | "online"
  | "creator"
  | "misc";
export type GameMode = "single_player" | "online" | "creator";

/** A prerequisite. `hard` ones block a trophy; `soft` ones only lower its priority. */
export type Prereq =
  | { type: "story"; checkpoint: string }
  | { type: "trophy"; psnTrophyId: number }
  | { type: "flag"; flag: string }
  | { type: "counterAtLeast"; counter: string; value: number }
  | { type: "characterAvailable"; character: Character };

export interface MissableInfo {
  risk: "conditional" | "high";
  note: string;
  /** Story checkpoint after which the trophy can no longer be earned on this save. */
  closesAfter?: string;
  /** Checkpoint from which the app starts warning. */
  warnFrom?: string;
  sourceUrl: string;
}

export interface GuideLink {
  label: string;
  url: string;
}

export interface TrophyGuidance {
  trophyId: string;
  category: TrophyCategory;
  gameMode: GameMode;
  character: Character | "any" | null;
  difficulty: number | null;
  minutes: number | null;
  confidence: Confidence;
  estimateBasis: string | null;
  estimateSource: string | null;
  estimateDate: string | null;
  passive: boolean;
  onlineRequired: boolean;
  multiplayer: Multiplayer;
  missable: MissableInfo | null;
  prereqs: Prereq[];
  softPrereqs: Prereq[];
  relatedPsnIds: number[];
  phase: string | null;
  summary: string | null;
  steps: string[];
  guides: GuideLink[];
  /** Story checkpoint this trophy is awarded at (story trophies only). */
  storyCheckpoint: string | null;
  /** Linked progress counter, e.g. stunt jumps 0/50. */
  counter: { key: string; target: number } | null;
  guidanceSource: string | null;
}

/** Raw persisted status: verified (PSN) and manual records are stored separately. */
export interface TrophyStatusRecord {
  trophyId: string;
  psnState: "earned" | "locked" | null;
  psnEarnedAt: string | null;
  psnConfirmedAt: string | null;
  psnProgress: string | null;
  psnProgressTarget: string | null;
  manualState: "earned" | "locked" | null;
  manualUpdatedAt: string | null;
}

export type VerificationState =
  | "VERIFIED_EARNED"
  | "VERIFIED_LOCKED"
  | "UNVERIFIED"
  | "SYNC_ERROR"
  | "MANUAL";

export interface SetSyncState {
  setId: string;
  status: "never" | "ok" | "error";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** The status shown to the user, derived from a record plus the set's sync state. */
export interface ResolvedStatus {
  state: VerificationState;
  /** Best-known earned flag. null = genuinely unknown. */
  earned: boolean | null;
  earnedAt: string | null;
  /** Where `earned` comes from. */
  basis: "psn" | "manual" | "none";
  /** Timestamp of the last successful PSN confirmation, if any. */
  confirmedAt: string | null;
  /** Verified data older than the staleness threshold. */
  stale: boolean;
  /** Present when state is SYNC_ERROR: what the last good sync said. */
  previous: { state: "earned" | "locked" | null; confirmedAt: string | null } | null;
  /** Manual mark disagrees with PSN. */
  conflict: boolean;
  note: string | null;
}

export interface StoryCheckpoint {
  id: string;
  name: string;
  /** Approximate mission index (1-based) in the story. */
  index: number;
  note?: string;
}

export interface ProgressFlag {
  id: string;
  question: string;
  help: string;
}

export interface ProgressCounter {
  key: string;
  label: string;
  max: number;
  unit?: string;
}

export interface RoadmapPhase {
  id: string;
  name: string;
  description: string;
  order: number;
}

/** Per-game progress the user has told us about. Always manual, labelled as such. */
export interface UserProgress {
  /** Index of the last story checkpoint the user says they completed. */
  storyIndex: number | null;
  /** ending: "A" | "B" | "C" | "not_reached" | null (unknown) */
  ending: "A" | "B" | "C" | "not_reached" | null;
  flags: Record<string, boolean | null>;
  counters: Record<string, number | null>;
  updatedAt: Record<string, string>;
}

export interface Session {
  id: string;
  gameId: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "paused" | "ended";
  notes: string;
  isSample: boolean;
}

export interface SessionSegment {
  id: number;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface StatusEvent {
  id: number;
  trophyId: string;
  at: string;
  source: "psn" | "manual";
  fromState: string | null;
  toState: "earned" | "locked";
  earnedAt: string | null;
  sessionId: string | null;
}

export type RecommendationMode = "easiest" | "quickest" | "best_progress";
