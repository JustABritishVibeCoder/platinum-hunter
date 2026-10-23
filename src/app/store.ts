import { create } from "zustand";
import { DEFAULT_SETTINGS, type Settings } from "../db/repo/settings";
import type { PsnConnectionStatus } from "../psn/gateway";
import type { PsnProfile } from "../psn/profile";

export type Section =
  | "home"
  | "dashboard"
  | "session"
  | "games"
  | "game"
  | "explorer"
  | "roadmap"
  | "history"
  | "stats"
  | "psn"
  | "settings";

export interface Route {
  section: Section;
  gameId?: string;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info" | "warning";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  route: Route;
  history: Route[];
  navigate: (section: Section, params?: Omit<Route, "section">) => void;
  back: () => void;

  /** Incremented after every write; queries re-run when it changes. */
  dataVersion: number;
  invalidate: () => void;

  settings: Settings;
  setSettingsState: (s: Settings) => void;

  psn: PsnConnectionStatus | null;
  setPsn: (s: PsnConnectionStatus | null) => void;
  profile: PsnProfile | null;
  setProfile: (p: PsnProfile | null) => void;
  profileError: string | null;
  setProfileError: (e: string | null) => void;
  discord: "off" | "connected" | "unavailable" | "needs_id";
  setDiscord: (s: AppState["discord"]) => void;
  syncingSets: Record<string, boolean>;
  setSyncing: (setId: string, on: boolean) => void;

  trophyDrawer: string | null;
  openTrophy: (trophyId: string | null) => void;

  startPlayingOpen: boolean;
  setStartPlayingOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  quickEarnOpen: boolean;
  setQuickEarnOpen: (open: boolean) => void;
  addGameOpen: boolean;
  setAddGameOpen: (open: boolean) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  route: { section: "home" },
  history: [],
  navigate: (section, params) => {
    const current = get().route;
    set({ route: { section, ...params }, history: [...get().history.slice(-30), current], trophyDrawer: null });
  },
  back: () => {
    const h = get().history;
    if (!h.length) return;
    set({ route: h[h.length - 1], history: h.slice(0, -1) });
  },

  dataVersion: 0,
  invalidate: () => set({ dataVersion: get().dataVersion + 1 }),

  settings: DEFAULT_SETTINGS,
  setSettingsState: (s) => set({ settings: s }),

  psn: null,
  setPsn: (s) => set({ psn: s }),
  profile: null,
  setProfile: (p) => set({ profile: p }),
  profileError: null,
  setProfileError: (e) => set({ profileError: e }),
  discord: "off",
  setDiscord: (s) => set({ discord: s }),
  syncingSets: {},
  setSyncing: (setId, on) => set({ syncingSets: { ...get().syncingSets, [setId]: on } }),

  trophyDrawer: null,
  openTrophy: (trophyId) => set({ trophyDrawer: trophyId }),

  startPlayingOpen: false,
  setStartPlayingOpen: (open) => set({ startPlayingOpen: open }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  quickEarnOpen: false,
  setQuickEarnOpen: (open) => set({ quickEarnOpen: open }),
  addGameOpen: false,
  setAddGameOpen: (open) => set({ addGameOpen: open }),

  toasts: [],
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
