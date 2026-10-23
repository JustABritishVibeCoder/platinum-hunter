import { ChartColumn } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { loadOverview } from "../../app/overview";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { computeSessionStats, formatDuration } from "../../domain/sessions";
import { Badge, EmptyState, ErrorState, LoadingBlock, Panel, ProgressBar, SectionHeader, Stat } from "../../ui/primitives";
import { GradeGlyph } from "../../ui/trophy";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-3 py-2 text-[12px] shadow-xl shadow-black/50">
      <div className="mb-1 text-fg-3">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-fg-2">{p.name}</span>
          <span className="ml-auto font-mono text-fg">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export function Statistics() {
  const settings = useApp((s) => s.settings);
  const ov = useQuery(
    () => loadOverview({ includeSample: false, mode: settings.defaultMode, staleHours: settings.staleHours, includeOptional: settings.includeOptionalTrophies }),
    [settings.defaultMode],
  );

  const derived = useMemo(() => {
    if (!ov.data) return null;
    const sessions = ov.data.sessions.filter((s) => !s.session.isSample);
    const stats = computeSessionStats(sessions);
    const today = new Date();
    const days: { day: string; label: string; minutes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      days.push({ day: dayKey(d), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), minutes: 0 });
    }
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const s of sessions) {
      const d = byDay.get(dayKey(new Date(s.session.startedAt)));
      if (d) d.minutes += Math.round(s.durationMs / 60_000);
    }
    // Trophies earned per week (last 12 weeks) by source, from stored statuses.
    const weeks: { week: string; verified: number; manual: number; start: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(today.getTime() - (i * 7 + 6) * 86_400_000);
      start.setHours(0, 0, 0, 0);
      weeks.push({ week: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }), verified: 0, manual: 0, start: start.getTime() });
    }
    const earnedByGrade = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const g of ov.data.games) {
      if (g.bundle.game.isSample) continue;
      for (const t of g.bundle.trophies) {
        if (t.status.earned !== true) continue;
        earnedByGrade[t.trophy.grade]++;
        const at = t.status.earnedAt ? Date.parse(t.status.earnedAt) : NaN;
        if (Number.isNaN(at)) continue;
        for (let w = weeks.length - 1; w >= 0; w--) {
          if (at >= weeks[w].start) {
            if (t.status.basis === "psn") weeks[w].verified++;
            else weeks[w].manual++;
            break;
          }
        }
      }
    }
    return { sessions, stats, days, weeks, earnedByGrade, games: ov.data.games.filter((g) => !g.bundle.game.isSample) };
  }, [ov.data]);

  if (ov.error) return <ErrorState message={ov.error} onRetry={ov.reload} />;
  if (!derived) return <LoadingBlock rows={8} />;
  const { stats, days, weeks, earnedByGrade, games } = derived;
  const totalEarned = Object.values(earnedByGrade).reduce((a, b) => a + b, 0);
  const anyPlay = days.some((d) => d.minutes > 0);
  const anyTrophies = weeks.some((w) => w.verified + w.manual > 0);
  const axis = { stroke: "var(--text-3)", fontSize: 11, tickLine: false, axisLine: false } as const;

  return (
    <div className="space-y-5 fade-in">
      <SectionHeader eyebrow="Insights" title="Statistics" subtitle="Derived only from sessions and trophy records stored in Platinum Hunter. Sample data is excluded." />

      <section className="panel grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Trophies earned" value={totalEarned} hint="Verified and manual combined" />
        <Stat label="Tracked playtime" value={formatDuration(stats.totalMs, false)} hint="Time since Start, not console time" />
        <Stat label="Sessions" value={stats.count} hint={stats.count ? `Avg ${formatDuration(stats.averageMs, false)}` : undefined} />
        <Stat label="Trophies / session" value={stats.count ? stats.trophiesPerSession.toFixed(1) : "-"} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Tracked playtime, last 30 days">
          {anyPlay ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" {...axis} interval={4} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip unit=" min" />} />
                  <Bar dataKey="minutes" name="Minutes" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<ChartColumn className="size-5" />} title="No sessions in the last 30 days" />
          )}
        </Panel>
        <Panel title="Trophies earned per week">
          {anyTrophies ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="week" {...axis} interval={1} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip unit="" />} />
                  <Bar dataKey="verified" name="PSN-verified" stackId="a" fill="var(--ok)" maxBarSize={18} />
                  <Bar dataKey="manual" name="Manual" stackId="a" fill="var(--info)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<ChartColumn className="size-5" />} title="No dated trophies in the last 12 weeks" body="PSN-verified trophies use their real earned time; manual marks use the time you marked them." />
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Earned by grade">
          <ul className="space-y-2.5">
            {(["platinum", "gold", "silver", "bronze"] as const).map((g) => (
              <li key={g} className="flex items-center gap-3">
                <GradeGlyph grade={g} size={18} />
                <span className="w-16 text-[12.5px] capitalize text-fg-2">{g}</span>
                <span className="flex-1"><ProgressBar value={earnedByGrade[g]} max={Math.max(1, totalEarned)} tone={g === "platinum" ? "plat" : "accent"} label={`${g} share`} /></span>
                <span className="w-8 text-right font-mono text-[12.5px] text-fg tabular">{earnedByGrade[g]}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Per game">
          {games.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">No games.</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="label text-left">
                  <th className="pb-2 font-semibold">Game</th>
                  <th className="pb-2 font-semibold">Completion</th>
                  <th className="pb-2 text-right font-semibold">Verified</th>
                  <th className="pb-2 text-right font-semibold">Manual</th>
                  <th className="pb-2 text-right font-semibold">Tracked time</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const ms = derived.sessions.filter((s) => s.session.gameId === g.bundle.game.id).reduce((a, s) => a + s.durationMs, 0);
                  return (
                    <tr key={g.bundle.game.id} className="border-t border-line">
                      <td className="py-2 pr-3 text-fg">{g.bundle.game.title} <Badge>{g.bundle.game.platform}</Badge></td>
                      <td className="py-2 pr-3"><div className="flex items-center gap-2"><span className="w-24"><ProgressBar value={g.completion.percent} label="Completion" /></span><span className="font-mono text-fg-2">{g.completion.percent}%</span></div></td>
                      <td className="py-2 text-right font-mono text-ok">{g.completion.verifiedEarned}</td>
                      <td className="py-2 text-right font-mono text-info">{g.completion.manualEarned}</td>
                      <td className="py-2 text-right font-mono text-fg-2">{formatDuration(ms, false)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
