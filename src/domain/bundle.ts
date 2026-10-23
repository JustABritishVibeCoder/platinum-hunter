/** Everything the engines need about one game, loaded in a single pass. */
import type {
  Game,
  ProgressCounter,
  ProgressFlag,
  ResolvedStatus,
  SetSyncState,
  StoryCheckpoint,
  Trophy,
  TrophyGroup,
  TrophyGuidance,
  TrophySet,
  UserProgress,
} from "./types";

export interface GameMeta {
  story: {
    checkpoints: StoryCheckpoint[];
    minutesPerMission: number;
    totalMissions: number;
    orderNote: string;
    endings: {
      question: string;
      options: { id: "A" | "B" | "C"; label: string; removes: ("michael" | "franklin" | "trevor")[] }[];
    } | null;
  } | null;
  flags: ProgressFlag[];
  counters: ProgressCounter[];
  rankModel: { counter: string; anchors: { rank: number; rp: number }[]; rpPerHour: number; source: string } | null;
  phases: { id: string; name: string; description: string }[];
  estimates: { source: string; date: string; methodology: string; communityRateSource: string | null } | null;
}

export const EMPTY_META: GameMeta = {
  story: null,
  flags: [],
  counters: [],
  rankModel: null,
  phases: [],
  estimates: null,
};

export interface TrophyView {
  trophy: Trophy;
  guidance: TrophyGuidance | null;
  status: ResolvedStatus;
  requiredForPlatinum: boolean;
  groupName: string;
}

export interface GameBundle {
  game: Game;
  set: TrophySet;
  groups: TrophyGroup[];
  meta: GameMeta;
  trophies: TrophyView[];
  sync: SetSyncState | null;
  progress: UserProgress;
  /** trophyId -> ISO time until which the trophy is deprioritised. */
  skips: Record<string, string>;
  focusTrophyId: string | null;
}

export function emptyProgress(): UserProgress {
  return { storyIndex: null, ending: null, flags: {}, counters: {}, updatedAt: {} };
}
