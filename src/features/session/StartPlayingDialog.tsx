import { ArrowLeft, ArrowRight, BadgeCheck, Check, CircleDashed, Gamepad2, Play, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { startPlaying } from "../../app/actions";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { normaliseTitle } from "../../psn/binding";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, cx, EmptyState, inputClass } from "../../ui/primitives";
import { GameCover } from "../../ui/trophy";

interface Edition {
  gameId: string;
  title: string;
  platform: string;
  edition: string;
  region: string | null;
  cover: string | null;
  source: string;
  isSample: boolean;
  npCommunicationId: string | null;
  npServiceName: string | null;
  bound: boolean;
  idsVerified: boolean;
  completeness: string;
  trophyCount: number;
  datasetSource: string | null;
}

async function loadEditions(includeSample: boolean): Promise<Edition[]> {
  const rows = await getServices().db.select<Record<string, string | number | null>>(
    `SELECT g.id, g.title, g.platform, g.edition, g.region, g.cover_url, g.source, g.is_sample,
            s.np_communication_id, s.np_service_name, s.binding_status, s.ids_verified, s.dataset_completeness, s.dataset_source,
            (SELECT COUNT(*) FROM trophies t WHERE t.set_id = s.id) AS n
     FROM games g JOIN trophy_sets s ON s.game_id = g.id
     ${includeSample ? "" : "WHERE g.is_sample = 0"}
     ORDER BY g.title, g.platform DESC`,
  );
  return rows.map((r) => ({
    gameId: r.id as string,
    title: r.title as string,
    platform: r.platform as string,
    edition: r.edition as string,
    region: (r.region as string) ?? null,
    cover: (r.cover_url as string) ?? null,
    source: r.source as string,
    isSample: r.is_sample === 1,
    npCommunicationId: (r.np_communication_id as string) ?? null,
    npServiceName: (r.np_service_name as string) ?? null,
    bound: r.binding_status === "bound",
    idsVerified: r.ids_verified === 1,
    completeness: r.dataset_completeness as string,
    trophyCount: r.n as number,
    datasetSource: (r.dataset_source as string) ?? null,
  }));
}

function TrophySetLine({ e }: { e: Edition }) {
  const service = e.npServiceName === "trophy2" ? "PS5 trophy list (trophy2)" : e.npServiceName === "trophy" ? "PS4/PS3 trophy list (trophy)" : "Trophy list";
  if (e.bound && e.idsVerified) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ok">
        <BadgeCheck className="size-3.5" /> Verified {service} · {e.npCommunicationId}
      </span>
    );
  }
  if (e.bound) {
    return (
      <span className="inline-flex items-center gap-1.5 text-info">
        <CircleDashed className="size-3.5" /> Linked to {e.npCommunicationId} ({service}) · awaiting first sync
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-2">
      <CircleDashed className="size-3.5" /> {service} · {e.trophyCount} trophies from {e.datasetSource ?? "local data"} · not yet linked to PSN
    </span>
  );
}

const STEPS = ["Find game", "Choose edition", "Confirm"];

export function StartPlayingDialog() {
  const open = useApp((s) => s.startPlayingOpen);
  const setOpen = useApp((s) => s.setStartPlayingOpen);
  const navigate = useApp((s) => s.navigate);
  const includeSample = useApp((s) => s.settings.showSampleData);
  const defaultPlatform = useApp((s) => s.settings.defaultPlatform);
  const [step, setStep] = useState(0);
  const [term, setTerm] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Edition | null>(null);
  const [starting, setStarting] = useState(false);
  const { data } = useQuery(() => (open ? loadEditions(includeSample) : Promise.resolve([] as Edition[])), [open, includeSample]);

  const titles = useMemo(() => {
    const groups = new Map<string, Edition[]>();
    for (const e of data ?? []) {
      const key = normaliseTitle(e.title);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const q = normaliseTitle(term);
    return [...groups.entries()].filter(([k]) => !q || k.includes(q)).map(([key, eds]) => ({ key, name: eds[0].title, editions: eds }));
  }, [data, term]);

  const editions = titles.find((t) => t.key === title)?.editions ?? [];

  const reset = () => {
    setStep(0);
    setTerm("");
    setTitle(null);
    setChosen(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const pickTitle = (key: string) => {
    setTitle(key);
    const eds = titles.find((t) => t.key === key)?.editions ?? [];
    const preferred = eds.find((e) => e.platform === defaultPlatform);
    setChosen(eds.length === 1 ? eds[0] : (preferred ?? null));
    setStep(1);
  };

  const start = async () => {
    if (!chosen) return;
    setStarting(true);
    const id = await startPlaying(chosen.gameId);
    setStarting(false);
    if (id) close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      width="max-w-2xl"
      title="Start playing"
      description="Pick the exact game and edition. Session time is measured from when you press Start Session."
      footer={
        <>
          {step > 0 && (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step - 1)} className="mr-auto">
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {step === 1 && (
            <Button variant="primary" disabled={!chosen} icon={<ArrowRight className="size-4" />} onClick={() => setStep(2)}>
              Continue
            </Button>
          )}
          {step === 2 && (
            <Button variant="primary" size="lg" loading={starting} icon={<Play className="size-4" />} onClick={() => void start()} data-autofocus>
              Start Session
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-4 flex items-center gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cx(
                "flex size-5 items-center justify-center rounded-full border font-mono text-[10.5px]",
                i < step ? "border-accent bg-accent text-accent-ink" : i === step ? "border-accent text-accent-2" : "border-line-strong text-fg-3",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cx("text-[12px]", i === step ? "text-fg" : "text-fg-3")}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line-strong" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
            <input
              data-autofocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && titles.length === 1 && pickTitle(titles[0].key)}
              placeholder="Search your library, e.g. Grand Theft Auto V"
              aria-label="Search for a game"
              className={`${inputClass} !h-10 pl-9`}
            />
          </div>
          <ul className="mt-3 max-h-[46vh] space-y-1 overflow-y-auto">
            {titles.map((t) => (
              <li key={t.key}>
                <button onClick={() => pickTitle(t.key)} className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-transparent px-2.5 py-2 text-left hover:border-line hover:bg-surface-2">
                  <GameCover url={t.editions[0].cover} title={t.name} platform={t.editions[0].platform} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{t.name}</span>
                    <span className="block text-[12px] text-fg-3">
                      {t.editions.map((e) => e.platform).join(" · ")} · {t.editions.length} edition{t.editions.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  {t.editions.some((e) => e.isSample) && <Badge tone="warn">Sample</Badge>}
                  <ArrowRight className="size-4 text-fg-3" />
                </button>
              </li>
            ))}
          </ul>
          {data && titles.length === 0 && (
            <EmptyState
              icon={<Gamepad2 className="size-5" />}
              title="No matching game in your library"
              body="Add it manually, or import it from your PSN trophy list on the PSN Connection page."
              action={
                <Button
                  icon={<Plus className="size-4" />}
                  onClick={() => {
                    close();
                    navigate("games");
                  }}
                >
                  Go to My Games
                </Button>
              }
            />
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="label mb-2">Choose the exact edition and platform</div>
          <ul className="space-y-2" role="radiogroup" aria-label="Editions">
            {editions.map((e) => (
              <li key={e.gameId}>
                <button
                  role="radio"
                  aria-checked={chosen?.gameId === e.gameId}
                  onClick={() => setChosen(e)}
                  className={cx(
                    "flex w-full items-start gap-3 rounded-[var(--radius)] border p-3 text-left transition-colors",
                    chosen?.gameId === e.gameId ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-surface-2",
                  )}
                >
                  <GameCover url={e.cover} title={e.title} platform={e.platform} size={52} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-fg">{e.title}</span>
                      <Badge tone={e.platform === "PS5" ? "accent" : "neutral"}>{e.platform}</Badge>
                      {e.isSample && <Badge tone="warn">Sample</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-fg-2">
                      {e.edition}
                      {e.region ? ` · ${e.region}` : ""}
                    </span>
                    <span className="mt-1 block text-[12px]">
                      <TrophySetLine e={e} />
                    </span>
                  </span>
                  <span className={cx("mt-1 flex size-4 items-center justify-center rounded-full border", chosen?.gameId === e.gameId ? "border-accent bg-accent" : "border-line-strong")}>
                    {chosen?.gameId === e.gameId && <Check className="size-3 text-accent-ink" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {editions.length > 1 && (
            <p className="mt-3 text-[12px] text-fg-3">Each edition keeps its own trophy list and progress. PS4 and PS5 versions are never mixed.</p>
          )}
        </div>
      )}

      {step === 2 && chosen && (
        <div className="reticle panel flex gap-4 p-4">
          <GameCover url={chosen.cover} title={chosen.title} platform={chosen.platform} size={88} />
          <dl className="grid flex-1 grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-fg-3">Game</dt>
            <dd className="font-medium text-fg">{chosen.title}</dd>
            <dt className="text-fg-3">Platform</dt>
            <dd className="text-fg">{chosen.platform === "PS5" ? "PlayStation 5" : chosen.platform === "PS4" ? "PlayStation 4" : chosen.platform}</dd>
            <dt className="text-fg-3">Edition</dt>
            <dd className="text-fg">{chosen.edition}</dd>
            <dt className="text-fg-3">Trophy set</dt>
            <dd className="text-[12.5px]">
              <TrophySetLine e={chosen} />
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
