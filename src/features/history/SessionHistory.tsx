import { BadgeCheck, ChevronDown, Hand, Info, RotateCcwClock, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { saveSessionNotes } from "../../app/actions";
import { loadOverview, type SessionRow } from "../../app/overview";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { deleteSession } from "../../db/repo/sessions";
import { computeSessionStats, formatDuration } from "../../domain/sessions";
import { formatDateTime } from "../../lib/external";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, cx, EmptyState, ErrorState, inputClass, LoadingBlock, SectionHeader, Stat } from "../../ui/primitives";

function SessionItem({ s, names }: { s: SessionRow; names: Map<string, string> }) {
  const openTrophy = useApp((st) => st.openTrophy);
  const invalidate = useApp((st) => st.invalidate);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(s.session.notes);
  const [confirm, setConfirm] = useState(false);
  const verified = s.trophies.filter((t) => t.source === "psn");
  const manual = s.trophies.filter((t) => t.source === "manual");
  return (
    <li className="border-b border-line last:border-0">
      <button className="grid w-full grid-cols-[minmax(0,1fr)_170px_100px_150px_24px] items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg">{s.gameTitle}</span>
            {s.session.isSample && <Badge tone="warn">Sample</Badge>}
            {s.session.status !== "ended" && <Badge tone="accent">{s.session.status === "active" ? "Playing" : "Paused"}</Badge>}
          </span>
          <span className="block truncate text-[11.5px] text-fg-3">{s.platform} · {s.edition}</span>
        </span>
        <span className="text-[12px] text-fg-2">
          {formatDateTime(s.session.startedAt)}
          <span className="block text-[11px] text-fg-3">{s.session.endedAt ? `to ${new Date(s.session.endedAt).toLocaleTimeString(undefined, { timeStyle: "short" })}` : "in progress"}</span>
        </span>
        <span className="font-mono text-[13px] text-fg tabular">{formatDuration(s.durationMs, false)}</span>
        <span className="flex flex-wrap gap-1">
          {verified.length > 0 && <Badge tone="ok" icon={<BadgeCheck className="size-3" />}>{verified.length} verified</Badge>}
          {manual.length > 0 && <Badge tone="info" icon={<Hand className="size-3" />}>{manual.length} manual</Badge>}
          {!s.trophies.length && <span className="text-[11.5px] text-fg-3">No trophies</span>}
        </span>
        <ChevronDown className={cx("size-4 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line bg-elev px-4 py-3 md:grid-cols-2">
          <div>
            <div className="label mb-1.5">Trophies during this session</div>
            {s.trophies.length === 0 ? (
              <p className="text-[12px] text-fg-3">None recorded. Verified trophies appear after a PSN sync whose earned time falls inside this session.</p>
            ) : (
              <ul className="space-y-1">
                {s.trophies.map((t) => (
                  <li key={t.source + t.trophyId} className="flex items-center gap-2 text-[12.5px]">
                    {t.source === "psn" ? <BadgeCheck className="size-3.5 text-ok" /> : <Hand className="size-3.5 text-info" />}
                    <button className="text-fg hover:text-accent-2" onClick={() => openTrophy(t.trophyId)}>{names.get(t.trophyId) ?? t.trophyId}</button>
                    <span className="text-[11px] text-fg-3">{new Date(t.at).toLocaleTimeString(undefined, { timeStyle: "short" })} · {t.source === "psn" ? "PSN timestamp" : "manual mark"}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-[11px] text-fg-3">{s.segments.length} segment{s.segments.length === 1 ? "" : "s"} (pauses excluded from duration)</div>
          </div>
          <div>
            <div className="label mb-1.5">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== s.session.notes && void saveSessionNotes(s.session.id, notes)}
              rows={3}
              aria-label="Session notes"
              className={`${inputClass} !h-auto py-2`}
            />
            {s.session.status === "ended" && (
              <Button size="sm" variant="ghost" className="mt-2 text-danger" icon={<Trash className="size-3.5" />} onClick={() => setConfirm(true)}>
                Delete session
              </Button>
            )}
          </div>
        </div>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this session?"
        description="Removes it from history and statistics. Trophy statuses are not affected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={async () => { await deleteSession(getServices().db, s.session.id); setConfirm(false); invalidate(); }}>Delete</Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">{s.gameTitle}, {formatDateTime(s.session.startedAt)}, {formatDuration(s.durationMs, false)}.</p>
      </Dialog>
    </li>
  );
}

export function SessionHistory() {
  const settings = useApp((s) => s.settings);
  const ov = useQuery(
    () => loadOverview({ includeSample: settings.showSampleData, mode: settings.defaultMode, staleHours: settings.staleHours, includeOptional: settings.includeOptionalTrophies }),
    [settings.showSampleData, settings.defaultMode],
  );
  const names = useMemo(() => new Map((ov.data?.games ?? []).flatMap((g) => g.bundle.trophies.map((t) => [t.trophy.id, t.trophy.name] as const))), [ov.data]);
  const real = ov.data?.sessions.filter((s) => !s.session.isSample) ?? [];
  const stats = computeSessionStats(real);
  const recentGames = [...new Map(real.map((s) => [s.session.gameId, s.gameTitle])).values()].slice(0, 4);

  return (
    <div className="fade-in">
      <SectionHeader eyebrow="Sessions" title="Session History" subtitle="Every session you started in Platinum Hunter, with trophies attributed by timestamp." />
      <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-line bg-elev px-3 py-2 text-[12px] text-fg-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
        Durations measure time between Start and End in this app (pauses excluded). They are not console playtime, which Platinum Hunter cannot read.
      </div>
      {ov.error && <ErrorState message={ov.error} onRetry={ov.reload} />}
      <section className="panel mb-5 grid grid-cols-2 gap-5 p-5 lg:grid-cols-5">
        <Stat label="Total tracked" value={formatDuration(stats.totalMs, false)} hint={`${stats.count} sessions`} />
        <Stat label="Average" value={stats.count ? formatDuration(stats.averageMs, false) : "-"} />
        <Stat label="Longest" value={stats.count ? formatDuration(stats.longestMs, false) : "-"} />
        <Stat label="Trophies / session" value={stats.count ? stats.trophiesPerSession.toFixed(1) : "-"} hint={`${stats.trophiesVerified} verified · ${stats.trophiesManual} manual`} />
        <Stat label="Recently played" value={recentGames.length || "-"} hint={recentGames.join(", ") || "None"} />
      </section>
      {!ov.data ? (
        <LoadingBlock rows={6} />
      ) : ov.data.sessions.length === 0 ? (
        <div className="panel"><EmptyState icon={<RotateCcwClock className="size-5" />} title="No sessions yet" body="Sessions appear here after you press Start Playing." /></div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_170px_100px_150px_24px] gap-3 border-b border-line bg-elev px-4 py-2 label">
            <span>Game</span><span>Started</span><span>Duration</span><span>Trophies</span><span />
          </div>
          <ul>
            {ov.data.sessions.map((s) => (
              <SessionItem key={s.session.id} s={s} names={names} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
