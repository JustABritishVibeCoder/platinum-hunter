import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Crosshair,
  ExternalLink,
  Gauge,
  Info,
  List,
  RefreshCw,
  Shuffle,
  SkipForward,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useState } from "react";
import { markManual, skipTrophy, syncGame, unskip, workOn } from "../../app/actions";
import { useRecommendations } from "../../app/hooks";
import { usePsnEnabled, useSyncCooldown } from "../../app/psnPolicy";
import { useApp } from "../../app/store";
import type { GameBundle, TrophyView } from "../../domain/bundle";
import { formatMinutes } from "../../domain/estimates";
import { MODE_LABEL, type Recommendation } from "../../domain/recommend";
import type { RecommendationMode } from "../../domain/types";
import { openExternal } from "../../lib/external";
import { Badge, Button, cx, EmptyState, Segmented } from "../../ui/primitives";
import { DifficultyMeter, GRADE_LABEL, StatusBadge, TrophyIcon } from "../../ui/trophy";
import { QuestionPrompt } from "./QuestionPrompt";

const MODE_OPTIONS: { value: RecommendationMode; label: string }[] = [
  { value: "easiest", label: MODE_LABEL.easiest },
  { value: "quickest", label: MODE_LABEL.quickest },
  { value: "best_progress", label: MODE_LABEL.best_progress },
];

const GAME_MODE_LABEL = { single_player: "Story mode (offline)", online: "GTA Online", creator: "Rockstar Editor" } as const;

function PrereqList({ rec }: { rec: Recommendation }) {
  const all = [...rec.availability.hard.map((h) => ({ ...h, soft: false })), ...rec.availability.soft.map((s) => ({ ...s, soft: true }))];
  if (!all.length) return <p className="text-[12.5px] text-fg-3">No known prerequisites.</p>;
  return (
    <ul className="space-y-1.5">
      {all.map((p, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px]">
          {p.status === "met" ? (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-label="Confirmed" />
          ) : p.status === "unmet" ? (
            <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Not yet" />
          ) : (
            <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-info" aria-label="Unconfirmed" />
          )}
          <span className="min-w-0">
            <span className="text-fg">{p.label}</span>
            {p.soft && <span className="text-fg-3"> (timing advice)</span>}
            <span className="block text-[11.5px] text-fg-3">{p.basis}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Story trophies the player's progress implies are unlocked: confirm instead of replaying. */
function ConfirmStrip({ bundle, items }: { bundle: GameBundle; items: TrophyView[] }) {
  const [open, setOpen] = useState(false);
  const canSync = bundle.set.bindingStatus === "bound";
  const psnOn = usePsnEnabled();
  return (
    <div className="border-b border-[color:var(--info)]/20 bg-info-soft/50 px-4 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <CircleDashed className="size-4 text-info" aria-hidden />
        <span className="text-fg">
          {items.length} story troph{items.length === 1 ? "y" : "ies"} should already be unlocked based on your progress.
        </span>
        <span className="text-fg-2">{canSync && psnOn ? "Sync with PSN to verify, or confirm by hand." : "Confirm by hand (recorded as manual)."}</span>
        <button className="ml-auto text-[12px] font-medium text-info hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : "Review"}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {items.map((t) => (
            <li key={t.trophy.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-fg">{t.trophy.name}</span>
              <Button size="sm" variant="primary" onClick={() => void markManual(t.trophy.id, "earned", t.trophy.name)}>
                Unlocked
              </Button>
              <Button size="sm" onClick={() => void markManual(t.trophy.id, "locked")}>
                Not unlocked
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecommendationCard({ bundle, compact = false, showUrgent = true }: { bundle: GameBundle; compact?: boolean; showUrgent?: boolean }) {
  const defaultMode = useApp((s) => s.settings.defaultMode);
  const [mode, setMode] = useState<RecommendationMode>(defaultMode);
  const [index, setIndex] = useState(0);
  const result = useRecommendations(bundle, mode);
  const navigate = useApp((s) => s.navigate);
  const openTrophy = useApp((s) => s.openTrophy);
  const psn = useApp((s) => s.psn);
  const syncing = useApp((s) => s.syncingSets[bundle.set.id]);
  const psnOn = usePsnEnabled();
  const cooldown = useSyncCooldown();

  if (!result) return null;
  const ranked = result.ranked;
  const rec = ranked[Math.min(index, Math.max(0, ranked.length - 1))];
  const tv = rec?.trophy;
  const g = tv?.guidance;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <Crosshair className="size-4 text-accent-2" aria-hidden />
        <h2 className="font-display text-[12.5px] font-bold tracking-[0.14em] text-fg uppercase">Your next recommended trophy</h2>
      </div>
      <Segmented
        size="sm"
        label="Recommendation mode"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setIndex(0);
        }}
        options={MODE_OPTIONS}
      />
    </div>
  );

  if (!rec || !tv) {
    const done = result.remainingRequired === 0;
    return (
      <section className="panel reticle">
        {header}
        {result.toConfirm.length > 0 && <ConfirmStrip bundle={bundle} items={result.toConfirm.map((c) => c.trophy)} />}
        <EmptyState
          icon={done ? <CircleCheck className="size-5 text-ok" /> : <Target className="size-5" />}
          title={done ? "Nothing left to recommend" : "No trophy can be recommended right now"}
          body={
            done
              ? "Every trophy needed for the Platinum is earned (or marked earned)."
              : `${result.blocked.length} trophies are blocked by prerequisites and ${result.unobtainable.length} are unobtainable on this save. Check the roadmap for what to do first.`
          }
          action={<Button onClick={() => navigate("roadmap", { gameId: bundle.game.id })}>Open roadmap</Button>}
        />
      </section>
    );
  }

  const canSync = bundle.set.bindingStatus === "bound" && psn?.connected;

  return (
    <section className="panel reticle overflow-hidden" aria-label="Next recommended trophy">
      {header}

      {showUrgent && result.urgentMissables.length > 0 && (
        <div className="flex items-start gap-2.5 border-b border-[color:var(--warn)]/25 bg-warn-soft px-4 py-2.5 text-[12.5px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <span className="font-medium text-warn">Missable window approaching: </span>
            <span className="text-fg">{result.urgentMissables.map((m) => m.trophy.trophy.name).join(", ")}</span>
            <span className="text-fg-2">. Earn {result.urgentMissables.length === 1 ? "it" : "them"} before progressing the story.</span>
          </div>
        </div>
      )}

      {result.toConfirm.length > 0 && <ConfirmStrip bundle={bundle} items={result.toConfirm.map((c) => c.trophy)} />}

      <div className="p-4">
        <div className="flex items-start gap-4">
          <button onClick={() => openTrophy(tv.trophy.id)} aria-label={`Open ${tv.trophy.name} details`}>
            <TrophyIcon url={tv.trophy.iconUrl} grade={tv.trophy.grade} size={compact ? 56 : 72} earned={tv.status.earned} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{GRADE_LABEL[tv.trophy.grade]}</Badge>
              <StatusBadge status={tv.status} compact />
              {rec.tier === 2 && <Badge tone="info">Conditional</Badge>}
              {rec.tier === 3 && <Badge tone="warn">Skipped</Badge>}
              {g?.missable && <Badge tone="warn">Missable</Badge>}
              <span className="ml-auto font-mono text-[11px] text-fg-3">
                #{rec.rank} of {ranked.length}
              </span>
            </div>
            <button onClick={() => openTrophy(tv.trophy.id)} className="mt-1.5 block text-left">
              <h3 className="font-display text-[20px] leading-tight font-semibold text-fg hover:text-accent-2">{tv.trophy.name}</h3>
            </button>
            <p className="mt-1 text-[13px] text-fg-2" data-selectable>
              {tv.trophy.description}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
              <span className="inline-flex items-center gap-1.5 text-fg-2" title={rec.time.basis}>
                <Clock className="size-3.5 text-fg-3" />
                <span className="font-mono text-fg tabular">{formatMinutes(rec.time.minutes)}</span>
                {rec.time.assumption && <span className="text-fg-3">(assumed)</span>}
              </span>
              <span className="inline-flex items-center gap-1.5 text-fg-2" title={rec.difficulty.basis}>
                <Gauge className="size-3.5 text-fg-3" />
                <DifficultyMeter value={rec.difficulty.value} />
              </span>
              {g && (
                <span className="inline-flex items-center gap-1.5 text-fg-2">
                  {g.multiplayer === "required" ? <Users className="size-3.5 text-warn" /> : <Target className="size-3.5 text-fg-3" />}
                  {GAME_MODE_LABEL[g.gameMode]}
                  {g.multiplayer === "required" ? " · needs other players" : g.multiplayer === "optional" ? " · co-op optional" : " · solo"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={cx("mt-4 grid gap-4", compact ? "grid-cols-1" : "lg:grid-cols-2")}>
          <div>
            <div className="label mb-2">Why this trophy</div>
            <ul className="space-y-1.5">
              {rec.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] text-fg">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
                  {r}
                </li>
              ))}
            </ul>
            {rec.cautions.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {rec.cautions.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-warn">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="text-fg-2">{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="label mb-2">Prerequisites</div>
            <PrereqList rec={rec} />
          </div>
        </div>

        {rec.questions.length > 0 && (
          <div className="mt-4 space-y-2">
            {rec.questions.slice(0, compact ? 1 : 3).map((q) => (
              <QuestionPrompt key={q.key} q={q} bundle={bundle} compact={compact} />
            ))}
          </div>
        )}

        {!compact && g && g.steps.length > 0 && (
          <div className="mt-4">
            <div className="label mb-2">Steps</div>
            <ol className="space-y-1.5">
              {g.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-fg" data-selectable>
                  <span className="mt-px font-mono text-[11px] text-accent-2 tabular">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="mt-2 text-[11px] text-fg-3">Concise summary written for Platinum Hunter. Follow the linked guide for full details.</div>
          </div>
        )}

        {!compact && g?.missable && (
          <div className="mt-4 flex items-start gap-2.5 rounded-[var(--radius)] border border-[color:var(--warn)]/25 bg-warn-soft p-3 text-[12.5px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <div className="text-fg">{g.missable.note}</div>
              <button className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-warn hover:underline" onClick={() => openExternal(g.missable!.sourceUrl)}>
                Source <ExternalLink className="size-3" />
              </button>
            </div>
          </div>
        )}

        {!compact && g && g.guides.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {g.guides.map((l) => (
              <Button key={l.url} size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal(l.url)}>
                {l.label}
              </Button>
            ))}
          </div>
        )}

        <details className="mt-4 rounded-[var(--radius)] border border-line bg-elev px-3 py-2 text-[12px]">
          <summary className="flex cursor-default items-center gap-1.5 text-fg-2 select-none">
            <Info className="size-3.5" /> Information used for this recommendation
          </summary>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-fg-3">Unlock status</dt>
            <dd className="text-fg">{rec.provenance.unlockStatus}</dd>
            <dt className="text-fg-3">Estimates</dt>
            <dd className="text-fg">
              {rec.provenance.estimates}. {rec.time.basis}.
            </dd>
            <dt className="text-fg-3">Prerequisites</dt>
            <dd className="text-fg">{rec.provenance.prerequisites}</dd>
          </dl>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="primary" icon={<Target className="size-4" />} onClick={() => void workOn(bundle.game.id, tv.trophy.id, tv.trophy.name)}>
          {bundle.focusTrophyId === tv.trophy.id ? "Working on it" : "Work on this"}
        </Button>
        <Button icon={<Shuffle className="size-4" />} onClick={() => setIndex((i) => (i + 1) % ranked.length)} disabled={ranked.length < 2}>
          Another
        </Button>
        {rec.tier === 3 ? (
          <Button variant="ghost" onClick={() => void unskip(tv.trophy.id)}>
            Un-skip
          </Button>
        ) : (
          <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={() => void skipTrophy(tv.trophy.id, tv.trophy.name)}>
            Skip
          </Button>
        )}
        <Button variant="ghost" icon={<CircleCheck className="size-4" />} onClick={() => void markManual(tv.trophy.id, "earned", tv.trophy.name)} title="Record as earned manually (labelled MANUAL, not verified)">
          Mark earned (manual)
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {psnOn && (
          <Button
            variant="ghost"
            icon={<RefreshCw className="size-4" />}
            loading={!!syncing}
            disabled={!canSync || !cooldown.ready}
            title={!canSync ? "Connect PSN and link this game to sync" : cooldown.ready ? "Sync with PSN, then recalculate" : cooldown.label}
            onClick={() => void syncGame(bundle.set.id, bundle.game.title)}
          >
            Sync &amp; refresh
          </Button>
          )}
          <Button icon={<List className="size-4" />} onClick={() => navigate("explorer", { gameId: bundle.game.id })}>
            Full list
          </Button>
        </div>
      </div>

      {!compact && result.passive.length > 0 && (
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-fg-2">
          <span className="label mr-2">Earn alongside</span>
          {result.passive.map((p) => (
            <button key={p.trophy.id} className="mr-3 text-fg hover:text-accent-2" onClick={() => openTrophy(p.trophy.id)}>
              {p.trophy.name}
            </button>
          ))}
          <span className="text-fg-3">accumulates passively while you play.</span>
        </div>
      )}
    </section>
  );
}
