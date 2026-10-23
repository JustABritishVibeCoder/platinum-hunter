import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyAppearance, forgetProfile, refreshProfile, refreshPsnStatus, syncEverything } from "./app/actions";
import { applyPsnOptIn } from "./app/psnPolicy";
import { getServices, initServices } from "./app/services";
import { useApp } from "./app/store";
import { errorMessage } from "./db/driver";
import { loadSettings } from "./db/repo/settings";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Home } from "./features/home/Home";
import { Welcome } from "./features/home/Welcome";
import { QuickEarn } from "./features/quick/QuickEarn";
import { AddGameDialog } from "./features/games/MyGames";
import { DiscordPresence } from "./features/discord/DiscordPresence";
import { TrophyExplorer } from "./features/explorer/TrophyExplorer";
import { GameDetail } from "./features/games/GameDetail";
import { MyGames } from "./features/games/MyGames";
import { SessionHistory } from "./features/history/SessionHistory";
import { PsnConnection } from "./features/psn/PsnConnection";
import { Roadmap } from "./features/roadmap/Roadmap";
import { SessionScreen } from "./features/session/SessionScreen";
import { StartPlayingDialog } from "./features/session/StartPlayingDialog";
import { SettingsPage } from "./features/settings/Settings";
import { GlobalSearch } from "./features/shell/GlobalSearch";
import { BrandMark, Sidebar } from "./features/shell/Sidebar";
import { TopBar } from "./features/shell/TopBar";
import { Statistics } from "./features/stats/Statistics";
import { TrophyDrawer } from "./features/trophy/TrophyDrawer";
import { Toasts } from "./ui/Toasts";

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 1200);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return compact;
}

function Page() {
  const section = useApp((s) => s.route.section);
  switch (section) {
    case "home":
      return <Home />;
    case "dashboard":
      return <Dashboard />;
    case "session":
      return <SessionScreen />;
    case "games":
      return <MyGames />;
    case "game":
      return <GameDetail />;
    case "explorer":
      return <TrophyExplorer />;
    case "roadmap":
      return <Roadmap />;
    case "history":
      return <SessionHistory />;
    case "stats":
      return <Statistics />;
    case "psn":
      return <PsnConnection />;
    case "settings":
      return <SettingsPage />;
  }
}

function Shell() {
  const compact = useCompact();
  const route = useApp((s) => s.route);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route.section, route.gameId]);
  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-ink">
        Skip to content
      </a>
      <Sidebar compact={compact} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1480px] px-6 py-6">
            <Page />
          </div>
        </main>
      </div>
      <StartPlayingDialog />
      <TrophyDrawer />
      <GlobalSearch />
      <QuickEarn />
      <AddGameDialog />
      <Toasts />
      <DiscordPresence />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");
  const setSettings = useApp((s) => s.setSettingsState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initServices();
        const settings = await loadSettings(getServices().db);
        setSettings(settings);
        applyAppearance(settings);
        // Rust refuses every PSN request unless the user has opted in.
        await applyPsnOptIn(settings.psn.optIn).catch(() => undefined);
        await refreshPsnStatus();
        // With PSN off, drop any cached profile so nothing implies a live connection.
        if (settings.psn.optIn) void refreshProfile();
        else void forgetProfile();
        if (cancelled) return;
        setState("ready");
        // One sync at start-up, only if opted in and the hourly cooldown has passed.
        if (settings.psn.optIn && settings.syncOnLaunch && useApp.getState().psn?.connected) void syncEverything({ quietIfBlocked: true });
      } catch (e) {
        if (!cancelled) setState({ error: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  if (state === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <BrandMark size={44} />
        <LoaderCircle className="size-5 animate-spin text-fg-3" aria-label="Loading" />
      </div>
    );
  }
  if (typeof state === "object") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="panel max-w-lg p-6" role="alert">
          <div className="flex items-center gap-2 text-danger">
            <TriangleAlert className="size-5" />
            <span className="font-display text-[16px] font-semibold">Platinum Hunter could not start</span>
          </div>
          <p className="mt-2 text-[13px] text-fg-2">{state.error}</p>
          <p className="mt-2 text-[12px] text-fg-3">Your data has not been modified. If this persists, restore a backup from the app's data folder.</p>
        </div>
      </div>
    );
  }
  return <Gate />;
}

/** First run shows "Who's playing?"; afterwards the normal app. */
function Gate() {
  const named = useApp((s) => s.settings.displayName !== null);
  return named ? <Shell /> : <Welcome />;
}
