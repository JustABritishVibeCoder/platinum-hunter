import { List, Play, Plus, Route as RouteIcon, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { startPlaying } from "../../app/actions";
import { useOpenSession } from "../../app/hooks";
import { loadOverview, type GameSummary } from "../../app/overview";
import { cachedImage } from "../../app/services";
import { useApp } from "../../app/store";
import { useNow, useQuery } from "../../app/useQuery";
import { formatDuration, sessionDurationMs } from "../../domain/sessions";
import { timeAgo } from "../../lib/external";
import { Badge, Button, cx, ProgressBar } from "../../ui/primitives";
import { GameCover, GRADE_LABEL, GradeGlyph } from "../../ui/trophy";

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? "Late night hunt" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Blurred game art behind the home screen, like a console dashboard. */
function Backdrop({ url }: { url: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (url) void cachedImage(url).then((s) => !cancelled && setSrc(s));
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!src) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-6 h-[520px] overflow-hidden fade-in" aria-hidden>
      <img src={src} alt="" className="size-full scale-125 object-cover opacity-[0.22] blur-3xl" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,var(--bg)_100%)]" />
    </div>
  );
}

function Tile({ g, selected, onSelect, onOpen }: { g: GameSummary; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const size = selected ? 196 : 152;
  return (
    <div className="flex shrink-0 flex-col items-start" style={{ width: size }}>
      <button
        onClick={selected ? onOpen : onSelect}
        onFocus={onSelect}
        aria-label={`${g.bundle.game.title} (${g.bundle.game.platform})${selected ? ", press Enter to play" : ""}`}
        aria-pressed={selected}
        className={cx(
          "relative rounded-[14px] transition-all duration-200 outline-none",
          selected ? "shadow-[0_0_0_3px_var(--bg),0_0_0_5px_var(--text),0_22px_50px_rgb(0_0_0/0.55)]" : "opacity-80 hover:opacity-100",
        )}
        style={{ width: size, height: size }}
      >
        <GameCover url={g.bundle.game.coverUrl} title={g.bundle.game.title} platform={g.bundle.game.platform} size={size} className="!rounded-[14px]" />
        {g.completion.platinum.earned && (
          <span className="absolute top-2 right-2 rounded-full bg-black/60 p-1" title="Platinum earned">
            <GradeGlyph grade="platinum" size={16} />
          </span>
        )}
      </button>
      <div className={cx("mt-3 w-full transition-opacity", selected ? "opacity-100" : "opacity-0")}>
        <div className="truncate text-[13px] font-medium text-fg">{g.bundle.game.title}</div>
      </div>
    </div>
  );
}

export function Home() {
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const setAddGame = useApp((s) => s.setAddGameOpen);
  const setQuickEarn = useApp((s) => s.setQuickEarnOpen);
  const open = useOpenSession();
  const now = useNow();
  const ov = useQuery(
    () => loadOverview({ includeSample: settings.showSampleData, mode: settings.defaultMode, staleHours: settings.staleHours, includeOptional: settings.includeOptionalTrophies }),
    [settings.showSampleData, settings.defaultMode, settings.staleHours, settings.includeOptionalTrophies],
  );

  // Most recently played first, then most recently changed.
  const games = useMemo(() => {
    const list = [...(ov.data?.games ?? [])];
    const t = (g: GameSummary) => Date.parse(g.lastSession?.startedAt ?? g.bundle.game.updatedAt);
    return list.sort((a, b) => t(b) - t(a));
  }, [ov.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = games.find((g) => g.bundle.game.id === selectedId) ?? games[0] ?? null;

  const play = (g: GameSummary) => {
    if (open.data?.session.gameId === g.bundle.game.id) navigate("session", { gameId: g.bundle.game.id });
    else void startPlaying(g.bundle.game.id);
  };

  // Console-style navigation: arrows move between tiles, Enter plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector("[role=dialog]")) return;
      if (!games.length || !selected) return;
      const i = games.indexOf(selected);
      if (e.key === "ArrowRight") setSelectedId(games[Math.min(games.length - 1, i + 1)].bundle.game.id);
      if (e.key === "ArrowLeft") setSelectedId(games[Math.max(0, i - 1)].bundle.game.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [games, selected]);

  const name = settings.displayName ?? "Player";
  const sessionGame = open.data ? games.find((g) => g.bundle.game.id === open.data!.session.gameId) : null;
  const c = selected?.completion;
  const isPlayingSelected = !!selected && open.data?.session.gameId === selected.bundle.game.id;

  return (
    <div className="relative -mx-6 -mt-6 min-h-full px-8 pt-8 pb-10">
      <Backdrop url={selected?.bundle.game.coverUrl ?? null} />
      <div className="relative">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] text-fg-2">{greeting(now)}</div>
            <h1 className="font-display text-[30px] leading-tight font-semibold text-fg">Welcome back, {name}</h1>
          </div>
          <div className="text-right">
            <div className="font-mono text-[26px] font-medium text-fg tabular">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
            <div className="text-[12px] text-fg-3">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
          </div>
        </header>

        {sessionGame && open.data && (
          <button
            onClick={() => navigate("session", { gameId: sessionGame.bundle.game.id })}
            className="mt-6 flex items-center gap-3 rounded-full border border-accent-line bg-accent-soft py-1.5 pr-4 pl-1.5 text-left transition-colors hover:border-accent"
          >
            <GameCover url={sessionGame.bundle.game.coverUrl} title={sessionGame.bundle.game.title} platform={sessionGame.bundle.game.platform} size={30} className="!rounded-full" />
            <span className="text-[12.5px] text-fg">
              {open.data.session.status === "active" ? "Playing" : "Paused"} · {sessionGame.bundle.game.title}
            </span>
            <span className="font-mono text-[12.5px] text-accent-2 tabular">{formatDuration(sessionDurationMs(open.data.segments, now))}</span>
          </button>
        )}

        <h2 className="mt-10 font-display text-[20px] font-medium text-fg">What game are we playing today?</h2>

        <div className="-mx-2 mt-5 flex items-start gap-5 overflow-x-auto px-2 pt-2 pb-4" role="listbox" aria-label="Your games">
          {games.map((g) => (
            <Tile
              key={g.bundle.game.id}
              g={g}
              selected={selected?.bundle.game.id === g.bundle.game.id}
              onSelect={() => setSelectedId(g.bundle.game.id)}
              onOpen={() => play(g)}
            />
          ))}
          <button
            onClick={() => setAddGame(true)}
            className="flex size-[152px] shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-line-strong text-fg-2 transition-colors hover:border-accent hover:text-fg"
            aria-label="Add a game"
          >
            <Plus className="size-8" />
            <span className="text-[13px] font-medium">Add game</span>
          </button>
        </div>

        {selected && c && (
          <section className="mt-6 max-w-3xl fade-in" key={selected.bundle.game.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{selected.bundle.game.platform}</Badge>
              <span className="text-[12.5px] text-fg-2">{selected.bundle.game.edition}</span>
              {selected.lastSession && <span className="text-[12.5px] text-fg-3">· last played {timeAgo(selected.lastSession.startedAt, now)}</span>}
            </div>
            <h3 className="mt-2 font-display text-[36px] leading-none font-bold tracking-tight text-fg">{selected.bundle.game.title}</h3>

            <div className="mt-5 grid max-w-xl grid-cols-2 gap-6">
              <div>
                <div className="mb-1.5 flex justify-between text-[12px]">
                  <span className="text-fg-2">Trophies</span>
                  <span className="font-mono text-fg tabular">
                    {c.earned}/{c.total} · {c.percent}%
                  </span>
                </div>
                <ProgressBar value={c.percent} label="Trophy completion" />
              </div>
              {c.platinum.exists && (
                <div>
                  <div className="mb-1.5 flex justify-between text-[12px]">
                    <span className="inline-flex items-center gap-1 text-fg-2">
                      <GradeGlyph grade="platinum" size={13} /> Platinum
                    </span>
                    <span className="font-mono text-fg tabular">
                      {c.platinum.requiredEarned}/{c.platinum.requiredTotal}
                    </span>
                  </div>
                  <ProgressBar value={c.platinum.requiredEarned} max={c.platinum.requiredTotal} tone="plat" label="Platinum progress" />
                </div>
              )}
            </div>

            {selected.next && (
              <button
                onClick={() => navigate("dashboard")}
                className="mt-5 flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
              >
                <GradeGlyph grade={selected.next.trophy.trophy.grade} size={22} />
                <span>
                  <span className="block label">Next up</span>
                  <span className="block text-[13.5px] text-fg">
                    {selected.next.trophy.trophy.name} <span className="text-fg-3">· {GRADE_LABEL[selected.next.trophy.trophy.grade]}</span>
                  </span>
                </span>
              </button>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button variant="primary" size="lg" className="!rounded-full !px-8" icon={<Play className="size-4 fill-current" />} onClick={() => play(selected)}>
                {isPlayingSelected ? "Resume session" : "Start playing"}
              </Button>
              <Button size="lg" className="!rounded-full" icon={<Trophy className="size-4" />} onClick={() => setQuickEarn(true)}>
                I just earned…
              </Button>
              <Button size="lg" variant="ghost" className="!rounded-full" icon={<List className="size-4" />} onClick={() => navigate("explorer", { gameId: selected.bundle.game.id })}>
                Trophies
              </Button>
              <Button size="lg" variant="ghost" className="!rounded-full" icon={<RouteIcon className="size-4" />} onClick={() => navigate("roadmap", { gameId: selected.bundle.game.id })}>
                Roadmap
              </Button>
            </div>
            <p className="mt-3 text-[11.5px] text-fg-3">Tip: use ← → to switch games and Enter on the highlighted tile to play.</p>
          </section>
        )}

        {ov.data && games.length === 0 && (
          <p className="mt-6 text-[13px] text-fg-2">No games yet. Press Add game to start your library.</p>
        )}
      </div>
    </div>
  );
}
