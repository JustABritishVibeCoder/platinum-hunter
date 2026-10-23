import { BookOpen, CircleCheck, Globe, Hourglass, Medal, Puzzle, Sparkles, Swords, Target, TriangleAlert, Users, Zap, Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../../app/store";
import type { TrophyView } from "../../domain/bundle";
import { formatMinutes } from "../../domain/estimates";
import { cx } from "../../ui/primitives";
import { TrophyIcon } from "../../ui/trophy";

export interface CategoryRow {
  tv: TrophyView;
  minutes: number | null;
  difficulty: number | null;
}

interface Category {
  id: string;
  title: string;
  hint: string;
  icon: ReactNode;
  match: (r: CategoryRow) => boolean;
}

const unearned = (r: CategoryRow) => r.tv.status.earned !== true;
const g = (r: CategoryRow) => r.tv.guidance;

/** Categories, in display order. A trophy can appear in more than one. */
export const CATEGORIES: Category[] = [
  {
    id: "quick",
    title: "Quick wins",
    hint: "Unearned, solo, about 20 minutes or less and easy",
    icon: <Zap className="size-4 text-gold" />,
    match: (r) => unearned(r) && r.tv.requiredForPlatinum && !g(r)?.passive && g(r)?.multiplayer !== "required" && r.minutes !== null && r.minutes <= 20 && (r.difficulty ?? 10) <= 3,
  },
  { id: "missable", title: "Missable: do these first", hint: "Can be lost on this save", icon: <TriangleAlert className="size-4 text-warn" />, match: (r) => unearned(r) && !!g(r)?.missable },
  { id: "story", title: "Story", hint: "Unlock by playing the main story", icon: <BookOpen className="size-4 text-accent-2" />, match: (r) => g(r)?.category === "story" },
  { id: "collectibles", title: "Collectibles", hint: "Find every item of a type", icon: <Puzzle className="size-4 text-accent-2" />, match: (r) => g(r)?.category === "collectible" },
  { id: "side", title: "Side activities", hint: "Hobbies, money and odd jobs", icon: <Target className="size-4 text-accent-2" />, match: (r) => g(r)?.category === "side_activity" || g(r)?.category === "misc" },
  { id: "challenges", title: "Challenges", hint: "Skill-based goals", icon: <Swords className="size-4 text-accent-2" />, match: (r) => g(r)?.category === "challenge" },
  { id: "medals", title: "Gold Medals & 100%", hint: "Completionist trophies", icon: <Medal className="size-4 text-gold" />, match: (r) => g(r)?.category === "gold_medals" || g(r)?.category === "completion" },
  {
    id: "online-solo",
    title: "Online: solo",
    hint: "GTA Online, no other players needed",
    icon: <Globe className="size-4 text-info" />,
    match: (r) => !!g(r)?.onlineRequired && g(r)?.multiplayer !== "required" && r.tv.trophy.grade !== "platinum",
  },
  { id: "online-coop", title: "Online: needs other players", hint: "Plan these with friends or a boosting group", icon: <Users className="size-4 text-info" />, match: (r) => g(r)?.multiplayer === "required" && r.tv.trophy.grade !== "platinum" },
  { id: "grind", title: "Grinds", hint: "Unearned, 5+ hours", icon: <Hourglass className="size-4 text-fg-2" />, match: (r) => unearned(r) && !g(r)?.passive && r.minutes !== null && r.minutes >= 300 && r.tv.trophy.grade !== "platinum" },
  { id: "passive", title: "Earn while playing", hint: "Accumulate in the background", icon: <Sparkles className="size-4 text-accent-2" />, match: (r) => !!g(r)?.passive },
  { id: "addons", title: "Add-ons (not required)", hint: "Outside the Platinum's trophy group", icon: <Clapperboard className="size-4 text-fg-3" />, match: (r) => !r.tv.requiredForPlatinum },
  { id: "earned", title: "Earned", hint: "Verified or marked earned", icon: <CircleCheck className="size-4 text-ok" />, match: (r) => r.tv.status.earned === true },
];

export function CategoryView({ rows }: { rows: CategoryRow[] }) {
  const openTrophy = useApp((s) => s.openTrophy);
  const groups = CATEGORIES.map((c) => ({ c, items: rows.filter(c.match) })).filter((x) => x.items.length > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(({ c, items }) => {
        const left = items.filter((r) => r.tv.status.earned !== true).length;
        return (
          <section key={c.id} className="panel overflow-hidden" aria-labelledby={`cat-${c.id}`}>
            <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              {c.icon}
              <div className="min-w-0 flex-1">
                <h3 id={`cat-${c.id}`} className="text-[13.5px] font-semibold text-fg">
                  {c.title}
                </h3>
                <div className="text-[11.5px] text-fg-3">{c.hint}</div>
              </div>
              <span className="font-mono text-[12px] text-fg-2 tabular">{c.id === "earned" ? items.length : `${left} left`}</span>
            </header>
            <ul className="max-h-[300px] divide-y divide-line overflow-y-auto">
              {items.map((r) => (
                <li key={r.tv.trophy.id}>
                  <button onClick={() => openTrophy(r.tv.trophy.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
                    <TrophyIcon url={r.tv.trophy.iconUrl} grade={r.tv.trophy.grade} size={30} earned={r.tv.status.earned} />
                    <span className={cx("min-w-0 flex-1 truncate text-[13px]", r.tv.status.earned ? "text-fg-3 line-through" : "text-fg")}>{r.tv.trophy.name}</span>
                    <span className="font-mono text-[11.5px] text-fg-3 tabular">{g(r)?.passive ? "passive" : formatMinutes(r.minutes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
