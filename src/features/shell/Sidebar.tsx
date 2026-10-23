import {
  ChartColumn,
  House,
  Gamepad2,
  LayoutDashboard,
  Library,
  PlugZap,
  RotateCcwClock,
  Route as RouteIcon,
  Settings as SettingsIcon,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";
import { useOpenSession } from "../../app/hooks";
import { useApp, type Section } from "../../app/store";
import { usePsnEnabled } from "../../app/psnPolicy";
import { useNow } from "../../app/useQuery";
import { formatDuration, sessionDurationMs } from "../../domain/sessions";
import { cx } from "../../ui/primitives";
import { Avatar } from "../../ui/trophy";

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <circle cx="16" cy="15.5" r="10" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="11.5 4.2" strokeDashoffset="5.7" />
      <path d="M11.6 9.2h8.8v2.2c0 3.3-2 5.6-4.4 5.6s-4.4-2.3-4.4-5.6z" fill="var(--plat)" />
      <rect x="15.2" y="16.8" width="1.6" height="2.6" fill="var(--plat)" opacity=".85" />
      <rect x="12.6" y="19.6" width="6.8" height="1.8" rx=".6" fill="var(--plat)" />
    </svg>
  );
}

interface Item {
  section: Section | "start";
  label: string;
  icon: ReactNode;
}

const ITEMS: Item[] = [
  { section: "home", label: "Home", icon: <House className="size-[17px]" /> },
  { section: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-[17px]" /> },
  { section: "start", label: "Start Playing", icon: <Gamepad2 className="size-[17px]" /> },
  { section: "games", label: "My Games", icon: <Library className="size-[17px]" /> },
  { section: "explorer", label: "Trophy Explorer", icon: <Trophy className="size-[17px]" /> },
  { section: "roadmap", label: "Platinum Roadmap", icon: <RouteIcon className="size-[17px]" /> },
  { section: "history", label: "Session History", icon: <RotateCcwClock className="size-[17px]" /> },
  { section: "stats", label: "Statistics", icon: <ChartColumn className="size-[17px]" /> },
  { section: "psn", label: "PSN Connection", icon: <PlugZap className="size-[17px]" /> },
  { section: "settings", label: "Settings", icon: <SettingsIcon className="size-[17px]" /> },
];

function LiveSession({ compact }: { compact: boolean }) {
  const open = useOpenSession();
  const now = useNow();
  const navigate = useApp((s) => s.navigate);
  const o = open.data;
  if (!o) return null;
  const ms = sessionDurationMs(o.segments, now);
  return (
    <button
      onClick={() => navigate("session", { gameId: o.session.gameId })}
      className={cx("mx-2 mb-2 flex items-center gap-2.5 rounded-[var(--radius)] border border-accent-line bg-accent-soft text-left transition-colors hover:border-accent", compact ? "justify-center p-2" : "px-3 py-2")}
      aria-label="Open the active session"
    >
      <span className={cx("size-2 shrink-0 rounded-full", o.session.status === "active" ? "bg-accent live-dot" : "bg-warn")} />
      {!compact && (
        <span className="min-w-0">
          <span className="block text-[10.5px] font-semibold tracking-[0.08em] text-accent-2 uppercase">{o.session.status === "active" ? "Playing" : "Paused"}</span>
          <span className="block font-mono text-[13px] text-fg tabular">{formatDuration(ms)}</span>
        </span>
      )}
    </button>
  );
}

export function Sidebar({ compact }: { compact: boolean }) {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const setStart = useApp((s) => s.setStartPlayingOpen);
  const psn = useApp((s) => s.psn);
  const psnOn = usePsnEnabled();
  const profile = useApp((s) => s.profile);
  const open = useOpenSession();

  const activeSection = route.section === "game" ? "games" : route.section;

  return (
    <nav aria-label="Main" className={cx("flex h-full shrink-0 flex-col border-r border-line bg-elev", compact ? "w-[64px]" : "w-[228px]")}>
      <div className={cx("flex h-14 items-center gap-2.5 border-b border-line", compact ? "justify-center" : "px-4")}>
        <BrandMark />
        {!compact && (
          <div className="leading-none">
            <div className="font-display text-[13.5px] font-bold tracking-[0.14em] text-fg">PLATINUM</div>
            <div className="mt-[3px] font-display text-[10px] font-medium tracking-[0.42em] text-accent-2">HUNTER</div>
          </div>
        )}
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {ITEMS.map((item) => {
          const isActive = item.section === "start" ? activeSection === "session" : activeSection === item.section;
          return (
            <li key={item.section}>
              <button
                aria-current={isActive ? "page" : undefined}
                title={compact ? item.label : undefined}
                onClick={() => {
                  if (item.section === "start") {
                    if (open.data) navigate("session", { gameId: open.data.session.gameId });
                    else setStart(true);
                  } else navigate(item.section);
                }}
                className={cx(
                  "group relative flex h-9 w-full items-center gap-3 rounded-[var(--radius)] text-[13px] font-medium transition-colors",
                  compact ? "justify-center" : "px-3",
                  isActive ? "bg-surface-2 text-fg" : "text-fg-2 hover:bg-surface hover:text-fg",
                )}
              >
                {isActive && <span className="absolute top-2 bottom-2 left-0 w-[2px] rounded-full bg-accent" aria-hidden />}
                <span className={cx(isActive ? "text-accent-2" : "text-fg-3 group-hover:text-fg-2")}>{item.icon}</span>
                {!compact && <span className="truncate">{item.label}</span>}
                {!compact && item.section === "start" && open.data && <span className="ml-auto size-1.5 rounded-full bg-accent live-dot" aria-label="Session active" />}
              </button>
            </li>
          );
        })}
      </ul>

      <LiveSession compact={compact} />

      <button
        onClick={() => navigate("psn")}
        className={cx("flex items-center gap-2.5 border-t border-line text-left text-[12px] text-fg-3 hover:text-fg-2", compact ? "justify-center py-3" : "px-4 py-3")}
        title="PSN connection status"
      >
        {profile ? (
          <Avatar url={profile.avatarUrl} name={profile.onlineId} size={22} />
        ) : (
          <span className={cx("size-2 shrink-0 rounded-full", psn?.connected ? "bg-ok" : psn?.needsReauth ? "bg-warn" : "bg-fg-3")} />
        )}
        {!compact && (
          <span className="min-w-0 truncate">
            {profile && <span className="block truncate text-fg-2">{profile.onlineId}</span>}
            <span className="block truncate">{!psnOn ? "Manual tracking" : psn?.connected ? "PSN connected" : psn?.needsReauth ? "PSN sign-in expired" : "PSN not connected"}</span>
          </span>
        )}
      </button>
    </nav>
  );
}
