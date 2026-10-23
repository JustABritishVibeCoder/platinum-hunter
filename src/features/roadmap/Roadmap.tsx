import { Ban, ChevronDown, CircleCheck, CircleDashed, CircleDot, Lock, Route as RouteIcon, Signpost, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useBundle, useCurrentGameId } from "../../app/hooks";
import { useApp } from "../../app/store";
import { computeCompletion } from "../../domain/completion";
import { buildRoadmap, type RoadmapTask, type TaskState } from "../../domain/roadmap";
import { Badge, cx, EmptyState, LoadingBlock, Panel, ProgressBar, SectionHeader } from "../../ui/primitives";
import { GradeGlyph } from "../../ui/trophy";
import { ProgressEditor } from "../games/ProgressEditor";
import { QuestionPrompt } from "../recommend/QuestionPrompt";
import { GamePicker } from "../shared/GamePicker";

const STATE_META: Record<TaskState, { label: string; icon: React.ReactNode; tone: "ok" | "accent" | "neutral" | "info" | "danger" }> = {
  completed: { label: "Completed", icon: <CircleCheck className="size-4 text-ok" />, tone: "ok" },
  available: { label: "Available", icon: <CircleDot className="size-4 text-accent-2" />, tone: "accent" },
  blocked: { label: "Blocked", icon: <Lock className="size-4 text-fg-3" />, tone: "neutral" },
  unknown: { label: "Needs info", icon: <CircleDashed className="size-4 text-info" />, tone: "info" },
  unobtainable: { label: "Lost on this save", icon: <Ban className="size-4 text-danger" />, tone: "danger" },
};

function Task({ t, gameBundle }: { t: RoadmapTask; gameBundle: Parameters<typeof QuestionPrompt>[0]["bundle"] }) {
  const openTrophy = useApp((s) => s.openTrophy);
  const [expanded, setExpanded] = useState(false);
  const m = STATE_META[t.state];
  return (
    <li className={cx("rounded-[var(--radius)] border px-3 py-2.5", t.urgent ? "border-[color:var(--warn)]/40 bg-warn-soft" : "border-line bg-elev")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{t.kind === "decision" ? <Signpost className="size-4 text-accent-2" /> : m.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {t.trophy ? (
              <button className={cx("text-[13px] font-medium hover:text-accent-2", t.state === "completed" ? "text-fg-3" : "text-fg")} onClick={() => openTrophy(t.trophy!.trophy.id)}>
                {t.title}
              </button>
            ) : (
              <span className="text-[13px] font-medium text-fg">{t.title}</span>
            )}
            {t.trophy && <GradeGlyph grade={t.trophy.trophy.grade} size={14} />}
            <Badge tone={m.tone}>{t.kind === "decision" && t.state === "blocked" ? "Later" : m.label}</Badge>
            {t.urgent && <Badge tone="warn" icon={<TriangleAlert className="size-3" />}>Do before progressing</Badge>}
            {t.trophy?.guidance?.missable && !t.urgent && t.state !== "completed" && <Badge tone="warn">Missable</Badge>}
          </div>
          {t.state !== "completed" && <p className="mt-0.5 text-[12px] text-fg-2">{t.detail}</p>}
          {t.reasons.length > 0 && t.state !== "completed" && (
            <ul className="mt-1 space-y-0.5">
              {t.reasons.map((r, i) => (
                <li key={i} className="text-[11.5px] text-fg-3">{r}</li>
              ))}
            </ul>
          )}
          {t.questions.length > 0 && (
            <>
              <button className="mt-1.5 text-[11.5px] text-info hover:underline" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Hide question" : `Answer ${t.questions.length} quick question${t.questions.length === 1 ? "" : "s"}`}
              </button>
              {expanded && (
                <div className="mt-2 space-y-2">
                  {t.questions.map((q) => (
                    <QuestionPrompt key={q.key} q={q} bundle={gameBundle} compact />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function Roadmap() {
  const { gameId } = useCurrentGameId();
  const q = useBundle(gameId);
  const includeOptional = useApp((s) => s.settings.includeOptionalTrophies);
  const [showOptional, setShowOptional] = useState(includeOptional);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const bundle = q.data;
  const roadmap = useMemo(() => (bundle ? buildRoadmap(bundle, { includeOptional: showOptional }) : null), [bundle, showOptional]);

  if (!bundle || !roadmap) {
    return q.loading ? <LoadingBlock rows={8} /> : <div className="panel"><EmptyState icon={<RouteIcon className="size-5" />} title="No game selected" /></div>;
  }
  const c = computeCompletion(bundle.trophies);
  const curated = bundle.meta.phases.length > 0;

  return (
    <div className="fade-in">
      <SectionHeader
        eyebrow="Plan"
        title="Platinum Roadmap"
        subtitle={curated ? "Phases group the work; anything marked Available can be done now, in any order." : "No curated roadmap exists for this game, so trophies are listed by status."}
        actions={<GamePicker gameId={gameId} section="roadmap" />}
      />

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="panel flex flex-wrap items-center gap-5 px-4 py-3">
            <GradeGlyph grade="platinum" size={28} />
            <div className="min-w-[200px] flex-1">
              <div className="mb-1.5 flex justify-between text-[12.5px]">
                <span className="text-fg">Platinum progress</span>
                <span className="font-mono text-fg tabular">{c.platinum.requiredEarned}/{c.platinum.requiredTotal}</span>
              </div>
              <ProgressBar value={c.platinum.requiredEarned} max={c.platinum.requiredTotal} tone="plat" label="Platinum progress" />
            </div>
            <div className="flex flex-wrap gap-2 text-[11.5px]">
              {(Object.keys(STATE_META) as TaskState[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-fg-3">{STATE_META[s].icon}{STATE_META[s].label}</span>
              ))}
            </div>
          </div>

          {roadmap.urgent.length > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--warn)]/35 bg-warn-soft p-3.5">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
              <div>
                <div className="text-[13px] font-semibold text-warn">Before you continue the story</div>
                <p className="mt-0.5 text-[12.5px] text-fg">
                  {roadmap.urgent.map((u) => u.title).join(" · ")}
                </p>
                <p className="mt-0.5 text-[11.5px] text-fg-2">These can be lost if you progress further. Keep a manual save.</p>
              </div>
            </div>
          )}

          {roadmap.phases.map((p, i) => {
            const isCollapsed = collapsed[p.id] ?? p.state === "complete";
            return (
              <section key={p.id} className="panel">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed({ ...collapsed, [p.id]: !isCollapsed })}
                >
                  <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[12px]", p.state === "complete" ? "border-ok bg-ok-soft text-ok" : "border-line-strong text-fg-2")}>
                    {p.state === "complete" ? <CircleCheck className="size-4" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[15px] font-semibold text-fg">{p.name}</span>
                    <span className="block text-[12px] text-fg-3">{p.description}</span>
                  </span>
                  <span className="hidden w-32 sm:block"><ProgressBar value={p.completed} max={p.total} tone={p.state === "complete" ? "ok" : "accent"} label={`${p.name} progress`} /></span>
                  <span className="w-12 text-right font-mono text-[12px] text-fg-2 tabular">{p.completed}/{p.total}</span>
                  <ChevronDown className={cx("size-4 text-fg-3 transition-transform", !isCollapsed && "rotate-180")} />
                </button>
                {!isCollapsed && (
                  <ul className="space-y-2 border-t border-line p-3">
                    {p.tasks.map((t) => (
                      <Task key={t.id} t={t} gameBundle={bundle} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
            <input type="checkbox" checked={showOptional} onChange={(e) => setShowOptional(e.target.checked)} className="accent-[var(--accent)]" />
            Show add-on trophies that are not required for the Platinum
          </label>
        </div>

        <aside className="space-y-4">
          <Panel title="Your progress">
            <ProgressEditor bundle={bundle} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
