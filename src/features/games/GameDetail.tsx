import { BadgeCheck, ExternalLink, List, Play, Plus, RefreshCw, Route as RouteIcon, Trash, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { startPlaying, syncGame } from "../../app/actions";
import { useBundle } from "../../app/hooks";
import { usePsnEnabled, useSyncCooldown } from "../../app/psnPolicy";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { errorMessage } from "../../db/driver";
import { addManualTrophy } from "../../db/repo/games";
import { removeGame } from "../../db/repo/library";
import { evaluateAvailability } from "../../domain/availability";
import type { GameBundle, TrophyView } from "../../domain/bundle";
import { computeCompletion } from "../../domain/completion";
import { estimateTime, formatMinutes } from "../../domain/estimates";
import { buildProgressContext } from "../../domain/progress";
import type { Grade, TrophyCategory } from "../../domain/types";
import { formatDateTime, openExternal, timeAgo } from "../../lib/external";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, EmptyState, Field, inputClass, LoadingBlock, Panel, ProgressBar, ProgressRing, SectionHeader } from "../../ui/primitives";
import { GameCover, GRADE_LABEL, GradeGlyph, StatusBadge } from "../../ui/trophy";
import { ProgressEditor } from "./ProgressEditor";

const REQ_GROUPS: { title: string; categories: TrophyCategory[]; counters: string[] }[] = [
  { title: "Story progression", categories: ["story"], counters: [] },
  { title: "Collectibles", categories: ["collectible"], counters: ["spaceship_parts", "letter_scraps", "nuclear_waste", "stunt_jumps", "under_the_bridge", "knife_flights"] },
  { title: "Gold Medals", categories: ["gold_medals"], counters: ["gold_medals"] },
  { title: "100% completion", categories: ["completion"], counters: ["completion_percent"] },
  { title: "Side activities & challenges", categories: ["side_activity", "challenge", "misc"], counters: [] },
  { title: "GTA Online", categories: ["online"], counters: ["online_rank", "platinum_awards", "stores_robbed"] },
];

function Requirements({ bundle }: { bundle: GameBundle }) {
  const openTrophy = useApp((s) => s.openTrophy);
  const ctx = useMemo(() => buildProgressContext(bundle), [bundle]);
  const required = bundle.trophies.filter((t) => t.requiredForPlatinum && t.trophy.grade !== "platinum");
  const groups = REQ_GROUPS.map((g) => {
    const items = required.filter((t) => t.guidance && g.categories.includes(t.guidance.category));
    const earned = items.filter((t) => t.status.earned === true).length;
    let minutes = 0;
    let unknown = 0;
    for (const t of items) {
      if (t.status.earned === true) continue;
      const m = estimateTime(t, ctx, bundle).minutes;
      if (m === null) unknown++;
      else if (!t.guidance?.passive) minutes += m;
    }
    return { ...g, items, earned, minutes, unknown };
  }).filter((g) => g.items.length);
  if (!groups.length) return null;
  const total = groups.reduce((a, g) => a + g.minutes, 0);
  return (
    <Panel title="Platinum requirements" actions={<span className="text-[11.5px] text-fg-3">Estimated remaining: <span className="font-mono text-fg">{formatMinutes(total)}</span> (editorial estimate)</span>}>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-[var(--radius)] border border-line bg-elev p-3.5">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-medium text-fg">{g.title}</div>
              <div className="font-mono text-[12px] text-fg-2 tabular">
                {g.earned}/{g.items.length}
              </div>
            </div>
            <ProgressBar className="mt-2" value={g.earned} max={g.items.length} tone={g.earned === g.items.length ? "ok" : "accent"} label={`${g.title} progress`} />
            <div className="mt-2 text-[11.5px] text-fg-3">
              About {formatMinutes(g.minutes)} left{g.unknown ? `, ${g.unknown} without estimate` : ""}
            </div>
            {g.counters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.counters.map((k) => {
                  const c = bundle.meta.counters.find((x) => x.key === k);
                  if (!c) return null;
                  const v = ctx.counters[k];
                  return (
                    <Badge key={k} title={ctx.counterBasis[k]}>
                      {c.label}: {v ?? "?"}
                      {c.unit ?? `/${c.max}`}
                    </Badge>
                  );
                })}
              </div>
            )}
            <ul className="mt-2.5 space-y-1">
              {g.items.slice(0, 8).map((t) => (
                <li key={t.trophy.id}>
                  <button className="flex w-full items-center gap-2 text-left text-[12px]" onClick={() => openTrophy(t.trophy.id)}>
                    <GradeGlyph grade={t.trophy.grade} size={14} />
                    <span className={t.status.earned ? "text-fg-3 line-through" : "text-fg"}>{t.trophy.name}</span>
                    {t.guidance?.missable && !t.status.earned && <TriangleAlert className="size-3 text-warn" aria-label="Missable" />}
                  </button>
                </li>
              ))}
              {g.items.length > 8 && <li className="text-[11.5px] text-fg-3">+{g.items.length - 8} more in the Trophy Explorer</li>}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MissablePanel({ bundle }: { bundle: GameBundle }) {
  const openTrophy = useApp((s) => s.openTrophy);
  const ctx = buildProgressContext(bundle);
  const items = bundle.trophies
    .filter((t) => t.guidance?.missable && t.status.earned !== true)
    .map((t) => ({ t, av: evaluateAvailability(t, ctx, bundle) }));
  if (!items.length) return null;
  return (
    <Panel title="Missable trophy warnings">
      <ul className="space-y-2.5">
        {items.map(({ t, av }) => (
          <li key={t.trophy.id} className="flex items-start gap-2.5">
            <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${av.missable?.level === "urgent" || av.missable?.level === "lost" ? "text-danger" : "text-warn"}`} />
            <div className="min-w-0 flex-1">
              <button className="text-[13px] font-medium text-fg hover:text-accent-2" onClick={() => openTrophy(t.trophy.id)}>
                {t.trophy.name}
              </button>
              {av.missable?.level === "urgent" && <Badge tone="danger" className="ml-2">Act now</Badge>}
              {av.availability === "unobtainable" && <Badge tone="danger" className="ml-2">Lost on this save</Badge>}
              <p className="text-[12px] text-fg-2">{av.availability === "unobtainable" ? av.reasons.join(" ") : t.guidance!.missable!.note}</p>
              <button className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-fg-3 hover:text-fg-2" onClick={() => openExternal(t.guidance!.missable!.sourceUrl)}>
                Source <ExternalLink className="size-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddTrophyDialog({ bundle, open, onClose }: { bundle: GameBundle; open: boolean; onClose: () => void }) {
  const invalidate = useApp((s) => s.invalidate);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [grade, setGrade] = useState<Grade>("bronze");
  const submit = async () => {
    try {
      await addManualTrophy(getServices().db, bundle.game.id, { name, description: desc, grade });
      invalidate();
      setName("");
      setDesc("");
      onClose();
    } catch (e) {
      toast({ kind: "error", title: "Could not add trophy", body: errorMessage(e) });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a trophy manually"
      description="Manual trophies are labelled as such and are never presented as verified."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>Add trophy</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" htmlFor="at-name">
          <input id="at-name" data-autofocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Description" htmlFor="at-desc">
          <input id="at-desc" className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Grade" htmlFor="at-grade">
          <select id="at-grade" className={inputClass} value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
            {(["bronze", "silver", "gold", "platinum"] as Grade[]).map((g) => (
              <option key={g} value={g}>{GRADE_LABEL[g]}</option>
            ))}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

export function GameDetail() {
  const gameId = useApp((s) => s.route.gameId);
  const navigate = useApp((s) => s.navigate);
  const psn = useApp((s) => s.psn);
  const toast = useApp((s) => s.toast);
  const invalidate = useApp((s) => s.invalidate);
  const syncing = useApp((s) => (gameId ? s.syncingSets[`${gameId}:set`] : false));
  const psnOn = usePsnEnabled();
  const cooldown = useSyncCooldown();
  const q = useBundle(gameId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingTrophy, setAddingTrophy] = useState(false);
  const bundle = q.data;
  if (q.loading && !bundle) return <LoadingBlock rows={6} />;
  if (!bundle) return <div className="panel"><EmptyState icon={<List className="size-5" />} title="Game not found" action={<Button onClick={() => navigate("games")}>Back to library</Button>} /></div>;

  const c = computeCompletion(bundle.trophies);
  const plat: TrophyView | undefined = bundle.trophies.find((t) => t.trophy.grade === "platinum");
  const canSync = bundle.set.bindingStatus === "bound" && psn?.connected;

  return (
    <div className="space-y-5 fade-in">
      <SectionHeader
        eyebrow={`${bundle.game.platform} · ${bundle.game.source === "catalog" ? "Curated dataset" : bundle.game.source === "psn" ? "Imported from PSN" : bundle.game.source === "sample" ? "Sample data" : "Added manually"}`}
        title={bundle.game.title}
        subtitle={bundle.game.edition}
        actions={
          <>
            {psnOn && (
            <Button icon={<RefreshCw className="size-4" />} loading={!!syncing} disabled={!canSync || !cooldown.ready} title={!canSync ? "Connect PSN and link this game first" : cooldown.label} onClick={() => void syncGame(bundle.set.id, bundle.game.title)}>
              {cooldown.ready ? "Sync" : cooldown.label}
            </Button>
            )}
            <Button icon={<RouteIcon className="size-4" />} onClick={() => navigate("roadmap", { gameId: bundle.game.id })}>Roadmap</Button>
            <Button icon={<List className="size-4" />} onClick={() => navigate("explorer", { gameId: bundle.game.id })}>Trophies</Button>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void startPlaying(bundle.game.id)}>Start session</Button>
          </>
        }
      />

      <section className="panel reticle grid gap-6 p-5 lg:grid-cols-[auto_1fr_auto]">
        <GameCover url={bundle.game.coverUrl} title={bundle.game.title} platform={bundle.game.platform} size={132} />
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {(["platinum", "gold", "silver", "bronze"] as const).map((g) => (
              <div key={g} className="rounded-[var(--radius)] border border-line bg-elev p-3">
                <div className="flex items-center gap-1.5"><GradeGlyph grade={g} size={16} /><span className="label">{GRADE_LABEL[g]}</span></div>
                <div className="mt-1.5 font-mono text-[18px] font-semibold text-fg tabular">
                  {c.byGrade[g].earned}<span className="text-fg-3">/{c.byGrade[g].total}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 text-[12px]">
            <div><div className="text-fg-3">Earned (PSN-verified)</div><div className="font-mono text-[15px] text-ok tabular">{c.verifiedEarned}</div></div>
            <div><div className="text-fg-3">Earned (manual)</div><div className="font-mono text-[15px] text-info tabular">{c.manualEarned}</div></div>
            <div><div className="text-fg-3">Remaining / unknown</div><div className="font-mono text-[15px] text-fg tabular">{c.locked} / {c.unknown}</div></div>
          </div>
          <div className="text-[12px] text-fg-2">
            <span className="text-fg-3">Trophy set: </span>
            {bundle.set.npServiceName === "trophy2" ? "PS5 list (trophy2)" : bundle.set.npServiceName === "trophy" ? "PS4/PS3 list (trophy)" : "Unknown service"}
            {bundle.set.npCommunicationId ? (
              <span className="ml-1 inline-flex items-center gap-1 text-ok">
                {bundle.set.idsVerified && <BadgeCheck className="size-3.5" />} {bundle.set.npCommunicationId}
              </span>
            ) : (
              <span className="ml-1 text-fg-3">· not linked to PSN</span>
            )}
          </div>
          <div className="text-[12px] text-fg-3">
            Dataset: {bundle.set.datasetSource ?? "-"}
            {bundle.set.datasetRetrievedAt ? ` (${bundle.set.datasetRetrievedAt})` : ""} · completeness: <span className="text-fg-2">{bundle.set.datasetCompleteness}</span>
            {bundle.set.datasetSourceUrl && (
              <button className="ml-1.5 inline-flex items-center gap-0.5 text-accent-2 hover:underline" onClick={() => openExternal(bundle.set.datasetSourceUrl!)}>source <ExternalLink className="size-3" /></button>
            )}
          </div>
          <div className="text-[12px] text-fg-3">
            Last sync: {bundle.sync?.lastSuccessAt ? `${formatDateTime(bundle.sync.lastSuccessAt)} (${timeAgo(bundle.sync.lastSuccessAt)})` : "never"}
            {bundle.sync?.status === "error" && <span className="ml-2 text-danger">Last attempt failed: {bundle.sync.lastError}</span>}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-2">
          <ProgressRing value={c.percent} size={108} stroke={7} label={`${c.percent}% complete`}>
            <div className="text-center">
              <div className="font-mono text-[22px] font-semibold text-fg tabular">{c.percent}%</div>
              <div className="text-[10px] text-fg-3">complete</div>
            </div>
          </ProgressRing>
          {plat && (
            <div className="flex flex-col items-center gap-1">
              <StatusBadge status={plat.status} compact />
              <span className="text-[11.5px] text-fg-3">Platinum: {c.platinum.requiredEarned}/{c.platinum.requiredTotal} required</span>
            </div>
          )}
        </div>
      </section>

      <MissablePanel bundle={bundle} />
      <Requirements bundle={bundle} />

      <Panel title="Your progress" id="progress-editor">
        <ProgressEditor bundle={bundle} />
      </Panel>

      <div className="flex flex-wrap gap-2">
        {bundle.game.source === "manual" && (
          <Button icon={<Plus className="size-4" />} onClick={() => setAddingTrophy(true)}>Add trophy manually</Button>
        )}
        <Button variant="danger" icon={<Trash className="size-4" />} onClick={() => setConfirmDelete(true)} className="ml-auto">
          Remove game
        </Button>
      </div>

      <AddTrophyDialog bundle={bundle} open={addingTrophy} onClose={() => setAddingTrophy(false)} />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${bundle.game.title}?`}
        description="This deletes its trophies, statuses, sessions and notes from this computer. It cannot be undone (unless you restore a backup)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={<Trash className="size-4" />}
              onClick={async () => {
                try {
                  await removeGame(getServices().db, bundle.game.id);
                  setConfirmDelete(false);
                  invalidate();
                  navigate("games");
                  toast({ kind: "success", title: `Removed ${bundle.game.title}` });
                } catch (e) {
                  toast({ kind: "error", title: "Could not remove game", body: errorMessage(e) });
                }
              }}
            >
              Remove permanently
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">Your PSN trophies are not affected. Only local data in Platinum Hunter is removed.</p>
      </Dialog>
    </div>
  );
}
