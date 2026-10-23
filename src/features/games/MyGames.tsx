import { Clock, Library, PlugZap, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { getServices } from "../../app/services";
import { loadOverview, type GameSummary } from "../../app/overview";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { errorMessage } from "../../db/driver";
import { createManualGame } from "../../db/repo/games";
import { formatMinutes } from "../../domain/estimates";
import { PLATFORMS, type Platform } from "../../domain/types";
import { timeAgo } from "../../lib/external";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, EmptyState, ErrorState, Field, inputClass, LoadingBlock, ProgressBar, SectionHeader } from "../../ui/primitives";
import { GameCover, GradeGlyph } from "../../ui/trophy";

/** Global "Add a game manually" dialog, opened from My Games or the home screen. */
export function AddGameDialog() {
  const open = useApp((s) => s.addGameOpen);
  const setOpen = useApp((s) => s.setAddGameOpen);
  const onClose = () => setOpen(false);
  const defaultPlatform = useApp((s) => s.settings.defaultPlatform);
  const invalidate = useApp((s) => s.invalidate);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>(defaultPlatform);
  const [edition, setEdition] = useState("Standard");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const id = await createManualGame(getServices().db, { title, platform, edition, region: region.trim() || null });
      invalidate();
      toast({ kind: "success", title: `Added ${title}`, body: "Add its trophies on the game page, or link it to PSN to import them." });
      onClose();
      navigate("game", { gameId: id });
    } catch (e) {
      toast({ kind: "error", title: "Could not add game", body: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a game manually"
      description="For games without PSN data. Its trophies will be labelled manual until linked to PSN."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void submit()}>
            Add game
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Title" htmlFor="ag-title">
          <input id="ag-title" data-autofocus className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform" htmlFor="ag-platform">
            <select id="ag-platform" className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Region (optional)" htmlFor="ag-region">
            <input id="ag-region" className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} maxLength={40} placeholder="e.g. EU" />
          </Field>
        </div>
        <Field label="Edition" htmlFor="ag-edition" hint="Each edition keeps separate trophy progress.">
          <input id="ag-edition" className={inputClass} value={edition} onChange={(e) => setEdition(e.target.value)} maxLength={120} />
        </Field>
      </form>
    </Dialog>
  );
}

function GameCard({ g }: { g: GameSummary }) {
  const navigate = useApp((s) => s.navigate);
  const { bundle, completion } = g;
  const plat = completion.platinum;
  return (
    <button onClick={() => navigate("game", { gameId: bundle.game.id })} className="panel group flex flex-col p-4 text-left transition-colors hover:border-line-strong">
      <div className="flex gap-3.5">
        <GameCover url={bundle.game.coverUrl} title={bundle.game.title} platform={bundle.game.platform} size={68} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={bundle.game.platform === "PS5" ? "accent" : "neutral"}>{bundle.game.platform}</Badge>
            {bundle.game.isSample && <Badge tone="warn">Sample</Badge>}
            {bundle.set.bindingStatus === "bound" ? <Badge tone="ok">PSN linked</Badge> : <Badge>Not linked</Badge>}
          </div>
          <div className="mt-1.5 truncate font-display text-[15px] font-semibold text-fg group-hover:text-accent-2">{bundle.game.title}</div>
          <div className="truncate text-[12px] text-fg-3">{bundle.game.edition}</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[12px]">
          <span className="text-fg-2">
            {completion.earned}/{completion.total} trophies
          </span>
          <span className="font-mono text-fg tabular">{completion.percent}%</span>
        </div>
        <ProgressBar value={completion.percent} label={`${bundle.game.title} completion`} />
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-fg-3">
          {(["platinum", "gold", "silver", "bronze"] as const).map((gr) => (
            <span key={gr} className="inline-flex items-center gap-1 font-mono tabular">
              <GradeGlyph grade={gr} size={13} />
              {completion.byGrade[gr].earned}/{completion.byGrade[gr].total}
            </span>
          ))}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-[11.5px]">
        <div>
          <dt className="text-fg-3">Platinum</dt>
          <dd className="text-fg">{!plat.exists ? "No Platinum" : plat.earned ? `Earned (${plat.basis === "psn" ? "PSN" : "manual"})` : `${plat.requiredEarned}/${plat.requiredTotal} required`}</dd>
        </div>
        <div>
          <dt className="text-fg-3">Est. remaining</dt>
          <dd className="text-fg" title="Sum of editorial estimates for remaining Platinum trophies">
            {g.remainingMinutes !== null ? formatMinutes(g.remainingMinutes) : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-fg-3">Last played</dt>
          <dd className="inline-flex items-center gap-1 text-fg">
            <Clock className="size-3 text-fg-3" />
            {g.lastSession ? timeAgo(g.lastSession.startedAt) : "Never"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-3">Next trophy</dt>
          <dd className="truncate text-fg">{g.next ? g.next.trophy.trophy.name : "-"}</dd>
        </div>
      </dl>
    </button>
  );
}

export function MyGames() {
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const [term, setTerm] = useState("");
  const ov = useQuery(
    () => loadOverview({ includeSample: settings.showSampleData, mode: settings.defaultMode, staleHours: settings.staleHours, includeOptional: settings.includeOptionalTrophies }),
    [settings.showSampleData, settings.defaultMode, settings.staleHours, settings.includeOptionalTrophies],
  );
  const games = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (ov.data?.games ?? []).filter((g) => !q || `${g.bundle.game.title} ${g.bundle.game.platform} ${g.bundle.game.edition}`.toLowerCase().includes(q));
  }, [ov.data, term]);

  return (
    <div className="fade-in">
      <SectionHeader
        eyebrow="Library"
        title="My Games"
        subtitle="Every edition keeps its own trophy list and progress."
        actions={
          <>
            <Button icon={<PlugZap className="size-4" />} onClick={() => navigate("psn")}>
              Import from PSN
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => useApp.getState().setAddGameOpen(true)}>
              Add game
            </Button>
          </>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter library" aria-label="Filter library" className={`${inputClass} pl-9`} />
      </div>
      {ov.error && <ErrorState message={ov.error} onRetry={ov.reload} />}
      {!ov.data ? (
        <LoadingBlock rows={4} />
      ) : games.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Library className="size-5" />} title={term ? "No games match your filter" : "Your library is empty"} body="Add a game manually or import one from your PSN trophy list." />
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {games.map((g) => (
            <GameCard key={g.bundle.game.id} g={g} />
          ))}
        </div>
      )}
    </div>
  );
}
