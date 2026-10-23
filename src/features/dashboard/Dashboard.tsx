import { ArrowRight, BadgeCheck, Check, Gamepad2, Hand, PlugZap, Play, Route as RouteIcon, Trophy, X } from "lucide-react";
import { updateSettings } from "../../app/actions";
import { useBundle, useCurrentGameId, useOpenSession } from "../../app/hooks";
import { loadOverview } from "../../app/overview";
import { useApp } from "../../app/store";
import { useNow, useQuery } from "../../app/useQuery";
import { computeSessionStats, formatDuration, sessionDurationMs } from "../../domain/sessions";
import { buildRoadmap } from "../../domain/roadmap";
import { timeAgo } from "../../lib/external";
import { Badge, Button, cx, EmptyState, ErrorState, LoadingBlock, Panel, ProgressBar, SectionHeader, Stat } from "../../ui/primitives";
import { GameCover, GradeGlyph } from "../../ui/trophy";
import { RecommendationCard } from "../recommend/RecommendationCard";
import type { Grade } from "../../domain/types";

function CurrentlyPlaying() {
  const open = useOpenSession();
  const now = useNow();
  const bundle = useBundle(open.data?.session.gameId);
  const navigate = useApp((s) => s.navigate);
  const setStart = useApp((s) => s.setStartPlayingOpen);
  const o = open.data;
  const b = bundle.data;

  return (
    <section className="panel reticle flex min-h-[132px] flex-wrap items-center gap-5 p-5">
      {o && b ? (
        <>
          <GameCover url={b.game.coverUrl} title={b.game.title} platform={b.game.platform} size={88} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-accent px-2 py-0.5 text-[10.5px] font-bold tracking-[0.14em] text-accent-ink">
                <span className={cx("size-1.5 rounded-full bg-accent-ink", o.session.status === "active" && "live-dot")} />
                {o.session.status === "active" ? "PLAYING" : "PAUSED"}
              </span>
            </div>
            <div className="mt-2 truncate font-display text-[20px] font-semibold text-fg">{b.game.title}</div>
            <div className="text-[12.5px] text-fg-2">
              {b.game.platform} · {b.game.edition}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Session</div>
            <div className="font-mono text-[28px] font-semibold text-fg tabular">{formatDuration(sessionDurationMs(o.segments, now))}</div>
          </div>
          <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />} onClick={() => navigate("session", { gameId: o.session.gameId })}>
            Open session
          </Button>
        </>
      ) : (
        <>
          <div className="flex size-14 items-center justify-center rounded-[var(--radius)] border border-accent-line bg-accent-soft text-accent-2">
            <Gamepad2 className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="label">Currently playing</div>
            <div className="mt-1 font-display text-[19px] font-semibold text-fg">Nothing right now</div>
            <div className="text-[12.5px] text-fg-2">Pick a game and start a session to get a live trophy plan.</div>
          </div>
          <Button variant="primary" size="lg" className="!h-12 !px-7 !text-[14px] tracking-[0.12em] font-bold" icon={<Play className="size-4 fill-current" />} onClick={() => setStart(true)}>
            START PLAYING
          </Button>
        </>
      )}
    </section>
  );
}

function Onboarding() {
  const navigate = useApp((s) => s.navigate);
  const setStart = useApp((s) => s.setStartPlayingOpen);
  const steps = [
    { done: true, title: "GTA V (PS5) trophy list is installed", body: "All 78 trophies of the native PS5 list, with cited guidance. Statuses start as Unverified.", action: () => navigate("explorer"), label: "Browse trophies" },
    {
      done: false,
      title: "Mark what you have earned",
      body: "Open the Trophy Explorer and mark trophies you already have. They are labelled Manual.",
      action: () => navigate("explorer"),
      label: "Open Trophy Explorer",
    },
    { done: false, title: "Tell it where you are", body: "Answer a couple of quick questions (story progress, Online access) so recommendations are accurate.", action: () => navigate("game", { gameId: "gta-v-ps5" }), label: "Set progress" },
    { done: false, title: "Start Playing", body: "Time your session and follow the next recommended trophy.", action: () => setStart(true), label: "Start Playing" },
  ];
  return (
    <Panel
      title="Get set up"
      actions={
        <button aria-label="Dismiss setup guide" className="text-fg-3 hover:text-fg" onClick={() => void updateSettings({ onboardingDismissed: true })}>
          <X className="size-4" />
        </button>
      }
    >
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-[var(--radius)] border border-line bg-elev p-3.5">
            <div className="flex items-center gap-2">
              <span className={cx("flex size-5 items-center justify-center rounded-full border font-mono text-[10.5px]", s.done ? "border-ok bg-ok text-bg" : "border-line-strong text-fg-3")}>
                {s.done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="text-[13px] font-medium text-fg">{s.title}</span>
            </div>
            <p className="mt-1.5 flex-1 text-[12px] text-fg-2">{s.body}</p>
            <Button size="sm" variant="ghost" className="mt-2 self-start !px-0 text-accent-2 hover:bg-transparent" onClick={s.action}>
              {s.label} <ArrowRight className="size-3.5" />
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function Dashboard() {
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const openTrophy = useApp((s) => s.openTrophy);
  const psn = useApp((s) => s.psn);
  const { gameId } = useCurrentGameId();
  const bundle = useBundle(gameId);
  const ov = useQuery(
    () => loadOverview({ includeSample: settings.showSampleData, mode: settings.defaultMode, staleHours: settings.staleHours, includeOptional: settings.includeOptionalTrophies }),
    [settings.showSampleData, settings.defaultMode, settings.staleHours, settings.includeOptionalTrophies],
  );

  const real = ov.data?.games.filter((g) => !g.bundle.game.isSample) ?? [];
  const realSessions = ov.data?.sessions.filter((s) => !s.session.isSample) ?? [];
  const earned = real.reduce((a, g) => a + g.completion.earned, 0);
  const verified = real.reduce((a, g) => a + g.completion.verifiedEarned, 0);
  const manual = real.reduce((a, g) => a + g.completion.manualEarned, 0);
  const total = real.reduce((a, g) => a + g.completion.total, 0);
  const platinums = real.filter((g) => g.completion.platinum.earned);
  const inProgress = real.filter((g) => g.completion.earned > 0 && !g.completion.platinum.earned);
  const stats = computeSessionStats(realSessions);
  const roadmap = bundle.data ? buildRoadmap(bundle.data) : null;
  const firstRun = !settings.onboardingDismissed && realSessions.length === 0 && !real.some((g) => g.bundle.sync?.lastSuccessAt);
  const lastSync = real.map((g) => g.bundle.sync?.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
  const syncErrors = real.filter((g) => g.bundle.sync?.status === "error");

  return (
    <div className="space-y-5 fade-in">
      <SectionHeader eyebrow="Overview" title="Dashboard" subtitle="Your trophy hunt at a glance. Every number below comes from your stored records." />

      <CurrentlyPlaying />
      {firstRun && <Onboarding />}
      {ov.error && <ErrorState message={ov.error} onRetry={ov.reload} />}

      <section className="panel grid grid-cols-2 gap-5 p-5 lg:grid-cols-5" aria-label="Key statistics">
        <Stat label="Trophies earned" value={ov.data ? earned : "-"} hint={ov.data ? `${verified} PSN-verified · ${manual} manual · of ${total}` : undefined} />
        <Stat label="Platinums" value={ov.data ? platinums.length : "-"} hint={platinums.length ? platinums.map((p) => p.bundle.game.title).join(", ") : "None yet"} accent />
        <Stat label="Games in progress" value={ov.data ? inProgress.length : "-"} hint={`${real.length} in library`} />
        <Stat label="Tracked playtime" value={ov.data ? formatDuration(stats.totalMs, false) : "-"} hint={`${stats.count} session${stats.count === 1 ? "" : "s"} · time since Start`} />
        <Stat label="Avg session" value={ov.data && stats.count ? formatDuration(stats.averageMs, false) : "-"} hint={stats.count ? `Longest ${formatDuration(stats.longestMs, false)}` : "No sessions yet"} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {bundle.data ? (
            <>
              <div className="flex items-center gap-2 text-[12px] text-fg-3">
                Recommending for <span className="text-fg-2">{bundle.data.game.title} ({bundle.data.game.platform})</span>
                <button className="text-accent-2 hover:underline" onClick={() => navigate("games")}>
                  change
                </button>
              </div>
              <RecommendationCard bundle={bundle.data} compact showUrgent={settings.notifications.missableWarnings} />
            </>
          ) : bundle.loading ? (
            <LoadingBlock rows={5} />
          ) : (
            <Panel>
              <EmptyState icon={<Trophy className="size-5" />} title="No games yet" body="Add a game in My Games or import one from PSN." action={<Button onClick={() => navigate("games")}>My Games</Button>} />
            </Panel>
          )}

          {roadmap && (
            <Panel
              title="Platinum roadmap"
              actions={
                <Button size="sm" variant="ghost" icon={<RouteIcon className="size-3.5" />} onClick={() => navigate("roadmap", { gameId: gameId ?? undefined })}>
                  Open
                </Button>
              }
            >
              <ul className="space-y-2.5">
                {roadmap.phases.map((p) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_120px_52px] items-center gap-3">
                    <span className="truncate text-[12.5px] text-fg">{p.name}</span>
                    <ProgressBar value={p.completed} max={p.total} tone={p.state === "complete" ? "ok" : "accent"} label={`${p.name} progress`} />
                    <span className="text-right font-mono text-[11.5px] text-fg-2 tabular">
                      {p.completed}/{p.total}
                    </span>
                  </li>
                ))}
              </ul>
              {settings.notifications.missableWarnings && roadmap.urgent.length > 0 && (
                <p className="mt-3 text-[12px] text-warn">
                  {roadmap.urgent.length} missable task{roadmap.urgent.length === 1 ? "" : "s"} need attention before you progress further.
                </p>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="PSN connection" actions={<Button size="sm" variant="ghost" icon={<PlugZap className="size-3.5" />} onClick={() => navigate("psn")}>Manage</Button>}>
            <div className="flex items-center gap-2.5">
              <span className={cx("size-2.5 rounded-full", psn?.connected ? "bg-ok" : psn?.needsReauth ? "bg-warn" : "bg-fg-3")} />
              <span className="text-[13px] text-fg">{psn?.connected ? "Connected" : psn?.needsReauth ? "Sign-in expired" : "Not connected: manual tracking"}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-fg-3">
              {lastSync ? `Last successful sync ${timeAgo(lastSync)}.` : "No successful sync yet. Statuses are unverified or manual."}
            </p>
            {syncErrors.length > 0 && <p className="mt-1 text-[12px] text-danger">Last sync failed for {syncErrors.map((g) => g.bundle.game.title).join(", ")}. Previous data kept.</p>}
          </Panel>

          <Panel title="Recently earned">
            {!ov.data ? (
              <LoadingBlock rows={3} />
            ) : ov.data.recent.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">No earned trophies recorded yet. They appear here after a PSN sync or when you mark one manually.</p>
            ) : (
              <ul className="space-y-2">
                {ov.data.recent.slice(0, 7).map((r) => (
                  <li key={r.trophyId}>
                    <button className="flex w-full items-center gap-2.5 text-left" onClick={() => openTrophy(r.trophyId)}>
                      <GradeGlyph grade={r.grade as Grade} size={18} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-fg">{r.name}</span>
                        <span className="block truncate text-[11px] text-fg-3">
                          {r.gameTitle} · {timeAgo(r.earnedAt)}
                        </span>
                      </span>
                      {r.basis === "psn" ? (
                        <Badge tone="ok" icon={<BadgeCheck className="size-3" />}>PSN</Badge>
                      ) : (
                        <Badge tone="info" icon={<Hand className="size-3" />}>Manual</Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Sessions">
            {stats.count === 0 ? (
              <p className="text-[12.5px] text-fg-3">No sessions yet. Press Start Playing to record one.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Sessions" value={stats.count} />
                <Stat label="Trophies / session" value={stats.trophiesPerSession.toFixed(1)} hint={`${stats.trophiesVerified} verified · ${stats.trophiesManual} manual`} />
              </div>
            )}
            <Button size="sm" variant="ghost" className="mt-3 !px-0 text-accent-2 hover:bg-transparent" onClick={() => navigate("history")}>
              Session history <ArrowRight className="size-3.5" />
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
