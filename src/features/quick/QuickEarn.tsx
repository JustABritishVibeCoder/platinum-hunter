import { CornerDownLeft, Search, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { markManual } from "../../app/actions";
import { useCurrentGameId } from "../../app/hooks";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { listGames, loadBundle } from "../../db/repo/games";
import type { TrophyView } from "../../domain/bundle";
import { cx, Kbd } from "../../ui/primitives";
import { GRADE_LABEL, TrophyIcon } from "../../ui/trophy";

interface Candidate {
  tv: TrophyView;
  gameTitle: string;
  platform: string;
  current: boolean;
}

async function loadCandidates(currentGameId: string | null): Promise<Candidate[]> {
  const db = getServices().db;
  const games = await listGames(db);
  const out: Candidate[] = [];
  for (const g of games) {
    const b = await loadBundle(db, g.id);
    if (!b) continue;
    for (const tv of b.trophies) {
      if (tv.status.earned === true || tv.trophy.grade === "platinum") continue;
      out.push({ tv, gameTitle: g.title, platform: g.platform, current: g.id === currentGameId });
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "");

/** Score a match: prefix > word-prefix > contains; current game first. */
function score(c: Candidate, q: string): number {
  const name = norm(c.tv.trophy.name);
  let s = name.startsWith(q) ? 0 : name.split(" ").some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : norm(c.tv.trophy.description).includes(q) ? 3 : 99;
  if (!c.current) s += 0.5;
  return s;
}

/** "I just earned…": type a trophy, press Enter, done. Recorded as a MANUAL mark. */
export function QuickEarn() {
  const open = useApp((s) => s.quickEarnOpen);
  const setOpen = useApp((s) => s.setQuickEarnOpen);
  const toast = useApp((s) => s.toast);
  const { gameId } = useCurrentGameId();
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const { data } = useQuery(() => (open ? loadCandidates(gameId) : Promise.resolve([] as Candidate[])), [open, gameId]);

  const hits = useMemo(() => {
    const q = norm(term.trim());
    const all = data ?? [];
    if (!q) return all.filter((c) => c.current).slice(0, 8);
    return all
      .map((c) => ({ c, s: score(c, q) }))
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || a.c.tv.trophy.sortOrder - b.c.tv.trophy.sortOrder)
      .slice(0, 8)
      .map((x) => x.c);
  }, [data, term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    setActive(0);
  }, [term]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setTerm("");
  };
  const choose = async (c: Candidate) => {
    close();
    await markManual(c.tv.trophy.id, "earned", c.tv.trophy.name, { quiet: true });
    toast({
      kind: "success",
      title: `Nice! ${c.tv.trophy.name} logged`,
      body: `${c.gameTitle} · recorded as earned (manual).`,
      action: { label: "Undo", run: () => void markManual(c.tv.trophy.id, null, c.tv.trophy.name, { quiet: true }) },
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel w-full max-w-xl overflow-hidden shadow-2xl shadow-black/60 pop-in" role="dialog" aria-modal="true" aria-label="Log a trophy you just earned">
        <div className="border-b border-line px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 font-display text-[18px] font-semibold text-fg">
            <Trophy className="size-5 text-gold" /> Which trophy did you just earn?
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-[var(--radius)] border border-line-strong bg-elev px-3">
            <Search className="size-4 text-fg-3" aria-hidden />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(hits.length - 1, a + 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                }
                if (e.key === "Enter" && hits[active]) void choose(hits[active]);
              }}
              placeholder="Start typing, e.g. Pimp My Sidearm"
              aria-label="Trophy name"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="quick-earn-results"
              className="h-11 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
            />
            <Kbd>Enter</Kbd>
          </div>
        </div>
        <ul id="quick-earn-results" role="listbox" className="max-h-[46vh] overflow-y-auto py-1.5">
          {data && hits.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-fg-3">{term ? `No unearned trophy matches "${term}".` : "No unearned trophies left. Nice work."}</li>}
          {!term && hits.length > 0 && <li className="px-5 pt-1 pb-1.5 label">Current game</li>}
          {hits.map((c, i) => (
            <li key={c.tv.trophy.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(c)}
                className={cx("flex w-full items-center gap-3 px-5 py-2 text-left", i === active && "bg-accent-soft")}
              >
                <TrophyIcon url={c.tv.trophy.iconUrl} grade={c.tv.trophy.grade} size={36} earned={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-fg">{c.tv.trophy.name}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">
                    {GRADE_LABEL[c.tv.trophy.grade]} · {c.gameTitle} ({c.platform}) · {c.tv.trophy.description}
                  </span>
                </span>
                {i === active && <CornerDownLeft className="size-4 text-accent-2" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-line px-5 py-2 text-[11px] text-fg-3">Saved as a manual mark. You can undo it from the notification. Shortcut: Ctrl+E</div>
      </div>
    </div>,
    document.body,
  );
}
