import { CircleCheck, CircleDashed, CircleX, ExternalLink, Eraser, Lock, NotebookPen, Plus, Target, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addObjective, markManual, saveNote, workOn } from "../../app/actions";
import { useBundle, useOpenSession } from "../../app/hooks";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { getNote } from "../../db/repo/sessions";
import { evaluateAvailability } from "../../domain/availability";
import { estimateDifficulty, estimateTime, formatMinutes } from "../../domain/estimates";
import { buildProgressContext } from "../../domain/progress";
import { formatDateTime, openExternal } from "../../lib/external";
import { Drawer } from "../../ui/Dialog";
import { Badge, Button, IconButton, inputClass, LoadingBlock } from "../../ui/primitives";
import { DifficultyMeter, GRADE_LABEL, SourceTag, StatusBadge, TrophyIcon } from "../../ui/trophy";
import { QuestionPrompt } from "../recommend/QuestionPrompt";

export function gameIdFromTrophyId(trophyId: string): string {
  const i = trophyId.indexOf(":set#");
  return i >= 0 ? trophyId.slice(0, i) : trophyId;
}

const STATE_EXPLAIN = {
  VERIFIED_EARNED: "The latest successful PSN sync confirms this trophy is unlocked.",
  VERIFIED_LOCKED: "The latest successful PSN sync confirms this trophy is still locked.",
  UNVERIFIED: "No PSN result exists for this trophy yet, and you haven't marked it. Its status is unknown.",
  SYNC_ERROR: "The latest sync attempt failed. The previous verified result (if any) is shown unchanged.",
  MANUAL: "You set this status by hand. It is not verified by PSN.",
} as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function NoteEditor({ trophyId }: { trophyId: string }) {
  const { data } = useQuery(() => getNote(getServices().db, trophyId), [trophyId]);
  const [text, setText] = useState("");
  useEffect(() => {
    setText(data ?? "");
  }, [data]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== (data ?? "") && void saveNote(trophyId, text)}
      rows={3}
      placeholder="Your notes for this trophy (saved locally when you click away)"
      aria-label="Trophy notes"
      className={`${inputClass} !h-auto py-2`}
    />
  );
}

export function TrophyDrawer() {
  const trophyId = useApp((s) => s.trophyDrawer);
  const close = useApp((s) => s.openTrophy);
  const gameId = trophyId ? gameIdFromTrophyId(trophyId) : null;
  const bundleQ = useBundle(gameId);
  const open = useOpenSession();
  const bundle = bundleQ.data;

  const view = useMemo(() => {
    if (!bundle || !trophyId) return null;
    const tv = bundle.trophies.find((t) => t.trophy.id === trophyId);
    if (!tv) return null;
    const ctx = buildProgressContext(bundle);
    return {
      tv,
      ctx,
      av: evaluateAvailability(tv, ctx, bundle),
      time: estimateTime(tv, ctx, bundle),
      diff: estimateDifficulty(tv),
      related: (tv.guidance?.relatedPsnIds ?? []).map((id) => ctx.trophyByPsnId.get(id)).filter((x): x is NonNullable<typeof x> => !!x),
    };
  }, [bundle, trophyId]);

  return (
    <Drawer open={!!trophyId} onClose={() => close(null)} label="Trophy details">
      {!view ? (
        <div className="p-6">{bundleQ.loading ? <LoadingBlock /> : <p className="text-fg-2">Trophy not found.</p>}</div>
      ) : (
        (() => {
          const { tv, av, time, diff, related } = view;
          const g = tv.guidance;
          const s = open.data?.session;
          const inSession = s && s.gameId === bundle!.game.id;
          const isObjective = inSession && open.data!.objectives.includes(tv.trophy.id);
          const rate = tv.trophy.psnEarnedRate ?? tv.trophy.communityEarnedRate;
          return (
            <div>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/95 px-5 py-3 backdrop-blur">
                <span className="truncate text-[12px] text-fg-3">
                  {bundle!.game.title} · {bundle!.game.platform} · {tv.groupName}
                </span>
                <IconButton label="Close details" onClick={() => close(null)}>
                  <X className="size-4" />
                </IconButton>
              </div>

              <div className="flex gap-4 px-5 py-5">
                <TrophyIcon url={tv.trophy.iconUrl} grade={tv.trophy.grade} size={84} earned={tv.status.earned} />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{GRADE_LABEL[tv.trophy.grade]}</Badge>
                    {!tv.requiredForPlatinum && <Badge tone="neutral">Not required for Platinum</Badge>}
                    {g?.missable && <Badge tone="warn">Missable</Badge>}
                    {tv.trophy.hidden && <Badge>Hidden on PSN</Badge>}
                  </div>
                  <h2 className="mt-2 font-display text-[22px] leading-tight font-semibold text-fg" data-selectable>
                    {tv.trophy.name}
                  </h2>
                  <div className="mt-2">
                    <StatusBadge status={tv.status} />
                  </div>
                </div>
              </div>

              <Section title="Verification">
                <p className="text-[12.5px] text-fg-2">{STATE_EXPLAIN[tv.status.state]}</p>
                {tv.status.note && <p className="mt-1 text-[12.5px] text-fg">{tv.status.note}</p>}
                <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-1 text-[12px]">
                  <dt className="text-fg-3">Last PSN confirmation</dt>
                  <dd className="text-fg">{formatDateTime(tv.status.confirmedAt)}</dd>
                  {tv.status.earnedAt && (
                    <>
                      <dt className="text-fg-3">{tv.status.basis === "psn" ? "Earned (PSN)" : "Marked earned"}</dt>
                      <dd className="text-fg">{formatDateTime(tv.status.earnedAt)}</dd>
                    </>
                  )}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" icon={<CircleCheck className="size-3.5" />} onClick={() => void markManual(tv.trophy.id, "earned", tv.trophy.name)}>
                    Mark earned (manual)
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Lock className="size-3.5" />} onClick={() => void markManual(tv.trophy.id, "locked")}>
                    Mark locked (manual)
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Eraser className="size-3.5" />} onClick={() => void markManual(tv.trophy.id, null)}>
                    Clear manual mark
                  </Button>
                </div>
              </Section>

              <Section title="Unlock requirement" aside={<SourceTag kind={tv.trophy.factsSource === "psn" ? "psn" : tv.trophy.factsSource} />}>
                <p className="text-[14px] text-fg" data-selectable>
                  {tv.trophy.description}
                </p>
                {tv.trophy.factsSource === "catalog" && bundle!.set.datasetSource && (
                  <p className="mt-1.5 text-[11.5px] text-fg-3">
                    Official text from {bundle!.set.datasetSource}
                    {bundle!.set.datasetRetrievedAt ? `, retrieved ${bundle!.set.datasetRetrievedAt}` : ""}. Will be confirmed against PSN on sync.
                  </p>
                )}
                {g?.summary && <p className="mt-2 text-[13px] text-fg-2">{g.summary}</p>}
              </Section>

              <Section title="Estimates" aside={g ? <SourceTag kind="editorial" /> : diff.proxy ? <SourceTag kind="community" /> : undefined}>
                <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[12.5px]">
                  <dt className="text-fg-3">Difficulty</dt>
                  <dd>
                    <DifficultyMeter value={diff.value} />
                    <div className="mt-0.5 text-[11.5px] text-fg-3">{diff.basis}</div>
                  </dd>
                  <dt className="text-fg-3">Time</dt>
                  <dd>
                    <span className="font-mono text-fg">{formatMinutes(time.minutes)}</span>
                    <div className="mt-0.5 text-[11.5px] text-fg-3">{time.basis}</div>
                  </dd>
                  <dt className="text-fg-3">Earn rate</dt>
                  <dd className="text-fg">
                    {rate !== null ? `${rate}%` : "Unknown"}
                    <div className="mt-0.5 text-[11.5px] text-fg-3">
                      {tv.trophy.psnEarnedRate !== null ? "PSN-wide rate from your last sync" : tv.trophy.communityRateSource ?? ""}
                    </div>
                  </dd>
                  {g && (
                    <>
                      <dt className="text-fg-3">Mode</dt>
                      <dd className="text-fg">
                        {g.gameMode === "online" ? "GTA Online" : g.gameMode === "creator" ? "Rockstar Editor" : "Story mode"}
                        {g.character && g.character !== "any" ? ` · ${g.character[0].toUpperCase()}${g.character.slice(1)} only` : ""}
                        {g.multiplayer === "required" ? " · needs other players" : g.multiplayer === "optional" ? " · co-op optional" : ""}
                      </dd>
                    </>
                  )}
                </dl>
                {g?.estimateSource && (
                  <p className="mt-2 text-[11px] text-fg-3">
                    {g.estimateSource}
                    {g.estimateDate ? `, ${g.estimateDate}` : ""} · {g.confidence} confidence. Not official data.
                  </p>
                )}
              </Section>

              {g?.missable && (
                <Section title="Missable warning">
                  <div className="flex gap-2.5 rounded-[var(--radius)] border border-[color:var(--warn)]/25 bg-warn-soft p-3 text-[12.5px]">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div>
                      <div className="text-fg">{av.missable?.level === "lost" ? av.missable.message : g.missable.note}</div>
                      <button className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-warn hover:underline" onClick={() => openExternal(g.missable!.sourceUrl)}>
                        Basis for this warning <ExternalLink className="size-3" />
                      </button>
                    </div>
                  </div>
                </Section>
              )}

              <Section title="Prerequisites">
                {av.hard.length + av.soft.length === 0 ? (
                  <p className="text-[12.5px] text-fg-3">No known prerequisites.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...av.hard.map((h) => ({ ...h, soft: false })), ...av.soft.map((x) => ({ ...x, soft: true }))].map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12.5px]">
                        {p.status === "met" ? (
                          <CircleCheck className="mt-0.5 size-3.5 text-ok" />
                        ) : p.status === "unmet" ? (
                          <CircleX className="mt-0.5 size-3.5 text-danger" />
                        ) : (
                          <CircleDashed className="mt-0.5 size-3.5 text-info" />
                        )}
                        <span>
                          <span className="text-fg">{p.label}</span>
                          {p.soft && <span className="text-fg-3"> (timing advice)</span>}
                          <span className="block text-[11.5px] text-fg-3">{p.basis}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {av.questions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {av.questions.map((q) => (
                      <QuestionPrompt key={q.key} q={q} bundle={bundle!} />
                    ))}
                  </div>
                )}
              </Section>

              {g && g.steps.length > 0 && (
                <Section title="Walkthrough" aside={<span className="text-[11px] text-fg-3">Original summary</span>}>
                  <ol className="space-y-2">
                    {g.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] text-fg" data-selectable>
                        <span className="mt-px font-mono text-[11px] text-accent-2">{String(i + 1).padStart(2, "0")}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}

              {related.length > 0 && (
                <Section title="Related trophies">
                  <div className="flex flex-wrap gap-1.5">
                    {related.map((r) => (
                      <button key={r.trophy.id} onClick={() => close(r.trophy.id)} className="rounded-[var(--radius)] border border-line bg-surface px-2.5 py-1 text-[12px] text-fg-2 hover:border-line-strong hover:text-fg">
                        {r.trophy.name}
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {g && g.guides.length > 0 && (
                <Section title="Guides">
                  <ul className="space-y-1">
                    {g.guides.map((l) => (
                      <li key={l.url}>
                        <button className="inline-flex items-center gap-1.5 text-[13px] text-accent-2 hover:underline" onClick={() => openExternal(l.url)}>
                          <ExternalLink className="size-3.5" /> {l.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Notes" aside={<NotebookPen className="size-3.5 text-fg-3" />}>
                <NoteEditor trophyId={tv.trophy.id} />
              </Section>

              <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-bg/95 px-5 py-3 backdrop-blur">
                <Button variant="primary" icon={<Target className="size-4" />} onClick={() => void workOn(bundle!.game.id, tv.trophy.id, tv.trophy.name)}>
                  Work on this
                </Button>
                <Button
                  icon={<Plus className="size-4" />}
                  disabled={!inSession || isObjective}
                  title={inSession ? undefined : "Start a session for this game to add objectives"}
                  onClick={() => s && void addObjective(s.id, tv.trophy.id)}
                >
                  {isObjective ? "In session objectives" : "Add to session objectives"}
                </Button>
              </div>
            </div>
          );
        })()
      )}
    </Drawer>
  );
}
