import { ArrowDownUp, Search, Trophy, TriangleAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useBundle, useCurrentGameId } from "../../app/hooks";
import { useApp } from "../../app/store";
import type { GameBundle, TrophyView } from "../../domain/bundle";
import { computeCompletion, GRADE_POINTS } from "../../domain/completion";
import { estimateDifficulty, estimateTime, formatMinutes } from "../../domain/estimates";
import { buildProgressContext } from "../../domain/progress";
import { Badge, cx, EmptyState, inputClass, LoadingBlock, ProgressBar, SectionHeader, Segmented } from "../../ui/primitives";
import { CategoryView } from "./CategoryView";
import { DifficultyMeter, GRADE_LABEL, SourceTag, StatusBadge, TrophyIcon } from "../../ui/trophy";
import { GamePicker } from "../shared/GamePicker";

type FilterKey =
  | "all" | "earned" | "locked" | "verified" | "unverified"
  | "platinum" | "gold" | "silver" | "bronze"
  | "easiest" | "quickest" | "missable" | "story" | "collectibles" | "challenges" | "online" | "multiplayer";

const FILTERS: { key: FilterKey; label: string; group: string }[] = [
  { key: "all", label: "All", group: "status" },
  { key: "earned", label: "Earned", group: "status" },
  { key: "locked", label: "Locked", group: "status" },
  { key: "verified", label: "Verified", group: "status" },
  { key: "unverified", label: "Unverified", group: "status" },
  { key: "platinum", label: "Platinum", group: "grade" },
  { key: "gold", label: "Gold", group: "grade" },
  { key: "silver", label: "Silver", group: "grade" },
  { key: "bronze", label: "Bronze", group: "grade" },
  { key: "easiest", label: "Easiest", group: "smart" },
  { key: "quickest", label: "Quickest", group: "smart" },
  { key: "missable", label: "Missable", group: "type" },
  { key: "story", label: "Story", group: "type" },
  { key: "collectibles", label: "Collectibles", group: "type" },
  { key: "challenges", label: "Challenges", group: "type" },
  { key: "online", label: "Online", group: "type" },
  { key: "multiplayer", label: "Multiplayer", group: "type" },
];

type SortKey = "default" | "name" | "grade" | "difficulty" | "time" | "rarity";

interface Row {
  tv: TrophyView;
  minutes: number | null;
  difficulty: number | null;
  rate: number | null;
}

function matches(f: FilterKey, r: Row): boolean {
  const { tv } = r;
  const g = tv.guidance;
  switch (f) {
    case "all": return true;
    case "earned": return tv.status.earned === true;
    case "locked": return tv.status.earned !== true;
    case "verified": return tv.status.basis === "psn";
    case "unverified": return tv.status.basis !== "psn";
    case "platinum": case "gold": case "silver": case "bronze": return tv.trophy.grade === f;
    case "easiest": return tv.status.earned !== true && r.difficulty !== null && r.difficulty <= 3;
    case "quickest": return tv.status.earned !== true && r.minutes !== null && r.minutes <= 30;
    case "missable": return !!g?.missable;
    case "story": return g?.category === "story";
    case "collectibles": return g?.category === "collectible";
    case "challenges": return g?.category === "challenge" || g?.category === "side_activity" || g?.category === "gold_medals" || g?.category === "completion";
    case "online": return !!g?.onlineRequired;
    case "multiplayer": return g?.multiplayer === "required";
  }
}

function useRows(bundle: GameBundle | null | undefined): Row[] {
  return useMemo(() => {
    if (!bundle) return [];
    const ctx = buildProgressContext(bundle);
    return bundle.trophies.map((tv) => ({
      tv,
      minutes: estimateTime(tv, ctx, bundle).minutes,
      difficulty: estimateDifficulty(tv).value,
      rate: tv.trophy.psnEarnedRate ?? tv.trophy.communityEarnedRate,
    }));
  }, [bundle]);
}

export function TrophyExplorer() {
  const { gameId } = useCurrentGameId();
  const q = useBundle(gameId);
  const openTrophy = useApp((s) => s.openTrophy);
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set(["all"]));
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [view, setView] = useState<"categories" | "list">("categories");
  const rows = useRows(q.data);

  const toggle = (k: FilterKey) => {
    setFilters((prev) => {
      if (k === "all") return new Set(["all"]);
      const next = new Set(prev);
      next.delete("all");
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (k === "easiest") setSort("difficulty");
      if (k === "quickest") setSort("time");
      return next.size ? next : new Set(["all"]);
    });
  };

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    // Filters within the same group are OR-ed; different groups are AND-ed.
    const byGroup = new Map<string, FilterKey[]>();
    for (const f of filters) {
      const grp = FILTERS.find((x) => x.key === f)!.group;
      byGroup.set(grp, [...(byGroup.get(grp) ?? []), f]);
    }
    const out = rows.filter(
      (r) =>
        [...byGroup.values()].every((fs) => fs.some((f) => matches(f, r))) &&
        (!t || r.tv.trophy.name.toLowerCase().includes(t) || r.tv.trophy.description.toLowerCase().includes(t)),
    );
    const num = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      default: (a, b) => a.tv.trophy.sortOrder - b.tv.trophy.sortOrder,
      name: (a, b) => a.tv.trophy.name.localeCompare(b.tv.trophy.name),
      grade: (a, b) => GRADE_POINTS[b.tv.trophy.grade] - GRADE_POINTS[a.tv.trophy.grade],
      difficulty: (a, b) => num(a.difficulty) - num(b.difficulty) || num(a.minutes) - num(b.minutes),
      time: (a, b) => num(a.minutes) - num(b.minutes) || num(a.difficulty) - num(b.difficulty),
      rarity: (a, b) => num(a.rate === null ? null : a.rate) - num(b.rate === null ? null : b.rate),
    };
    return out.sort(cmp[sort]);
  }, [rows, filters, term, sort]);

  const bundle = q.data;
  const c = bundle ? computeCompletion(bundle.trophies) : null;
  const groupOrder = ["status", "grade", "smart", "type"];

  return (
    <div className="fade-in">
      <SectionHeader
        eyebrow="Trophies"
        title="Trophy Explorer"
        subtitle="Every trophy with its verification state and where each piece of information comes from."
        actions={<GamePicker gameId={gameId} section="explorer" />}
      />

      {c && bundle && (
        <div className="panel mb-4 flex flex-wrap items-center gap-6 px-4 py-3">
          <div className="min-w-[220px] flex-1">
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span className="text-fg-2">{bundle.game.title} · {bundle.game.platform}</span>
              <span className="font-mono text-fg tabular">{c.earned}/{c.total} · {c.percent}%</span>
            </div>
            <ProgressBar value={c.percent} label="Completion" />
          </div>
          <div className="flex gap-5 text-[12px]">
            <span><span className="text-fg-3">PSN-verified </span><span className="font-mono text-ok">{c.verifiedEarned}</span></span>
            <span><span className="text-fg-3">Manual </span><span className="font-mono text-info">{c.manualEarned}</span></span>
            <span><span className="text-fg-3">Unknown </span><span className="font-mono text-fg">{c.unknown}</span></span>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search trophies" aria-label="Search trophies" className={`${inputClass} pl-9`} />
        </div>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "categories", label: "Categories" }, { value: "list", label: "List" }]} />
        <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-fg-3">
          <ArrowDownUp className="size-3.5" /> Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${inputClass} !h-8 !w-auto`} aria-label="Sort trophies">
            <option value="default">List order</option>
            <option value="name">Name</option>
            <option value="grade">Grade</option>
            <option value="difficulty">Difficulty (easiest first)</option>
            <option value="time">Time (quickest first)</option>
            <option value="rarity">Rarity (rarest first)</option>
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Filters">
        {groupOrder.map((grp) => (
          <div key={grp} className="flex flex-wrap gap-1">
            {FILTERS.filter((f) => f.group === grp).map((f) => {
              const on = filters.has(f.key);
              return (
                <button
                  key={f.key}
                  aria-pressed={on}
                  onClick={() => toggle(f.key)}
                  className={cx(
                    "h-7 rounded-[var(--radius)] border px-2.5 text-[12px] transition-colors",
                    on ? "border-accent-line bg-accent-soft text-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {!bundle ? (
        <LoadingBlock rows={8} />
      ) : visible.length === 0 ? (
        <div className="panel"><EmptyState icon={<Trophy className="size-5" />} title="No trophies match these filters" /></div>
      ) : view === "categories" ? (
        <CategoryView rows={visible} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_150px_120px_80px_70px] gap-3 border-b border-line bg-elev px-4 py-2 label">
            <span>Trophy · {visible.length}</span>
            <span>Status</span>
            <span>Difficulty</span>
            <span>Time</span>
            <span className="text-right">Earn rate</span>
          </div>
          <ul>
            {visible.map((r) => {
              const { tv } = r;
              const g = tv.guidance;
              return (
                <li key={tv.trophy.id} className="border-b border-line last:border-0">
                  <button
                    onClick={() => openTrophy(tv.trophy.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_150px_120px_80px_70px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <TrophyIcon url={tv.trophy.iconUrl} grade={tv.trophy.grade} size={38} earned={tv.status.earned} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={cx("truncate text-[13px] font-medium", tv.status.earned ? "text-fg-2" : "text-fg")}>{tv.trophy.name}</span>
                          {g?.missable && <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-label="Missable" />}
                          {g?.multiplayer === "required" && <Users className="size-3.5 shrink-0 text-fg-3" aria-label="Needs other players" />}
                        </span>
                        <span className="block truncate text-[11.5px] text-fg-3">{tv.trophy.description}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge>{GRADE_LABEL[tv.trophy.grade]}</Badge>
                          <SourceTag kind={tv.trophy.factsSource} />
                          {g && <SourceTag kind="editorial" />}
                          {!tv.requiredForPlatinum && <Badge>Add-on</Badge>}
                        </span>
                      </span>
                    </span>
                    <span><StatusBadge status={tv.status} compact /></span>
                    <span><DifficultyMeter value={r.difficulty} /></span>
                    <span className="font-mono text-[12px] text-fg-2 tabular">{g?.passive ? "passive" : formatMinutes(r.minutes)}</span>
                    <span className="text-right font-mono text-[12px] text-fg-2 tabular" title={tv.trophy.psnEarnedRate !== null ? "PSN earn rate" : tv.trophy.communityRateSource ?? ""}>
                      {r.rate !== null ? `${r.rate}%` : "-"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
