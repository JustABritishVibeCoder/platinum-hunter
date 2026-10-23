import { CornerDownLeft, Library, Search, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import type { Grade } from "../../domain/types";
import { cx, Kbd } from "../../ui/primitives";
import { GameCover, GradeGlyph } from "../../ui/trophy";

interface Hit {
  kind: "game" | "trophy";
  id: string;
  title: string;
  subtitle: string;
  gameId: string;
  grade?: Grade;
  cover?: string | null;
  platform?: string;
}

async function search(term: string, includeSample: boolean): Promise<Hit[]> {
  const q = term.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const db = getServices().db;
  const games = await db.select<{ id: string; title: string; platform: string; edition: string; cover_url: string | null }>(
    `SELECT id, title, platform, edition, cover_url FROM games WHERE (title LIKE ? ESCAPE '\\' OR edition LIKE ? ESCAPE '\\') ${includeSample ? "" : "AND is_sample = 0"} ORDER BY title LIMIT 6`,
    [like, like],
  );
  const trophies = await db.select<{ id: string; name: string; description: string; grade: Grade; game_id: string; title: string; platform: string }>(
    `SELECT t.id, t.name, t.description, t.grade, t.game_id, g.title, g.platform FROM trophies t JOIN games g ON g.id = t.game_id
     WHERE (t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\') ${includeSample ? "" : "AND g.is_sample = 0"}
     ORDER BY CASE WHEN t.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, t.name LIMIT 14`,
    [like, like, like],
  );
  return [
    ...games.map((g) => ({ kind: "game" as const, id: g.id, title: g.title, subtitle: `${g.platform} · ${g.edition}`, gameId: g.id, cover: g.cover_url, platform: g.platform })),
    ...trophies.map((t) => ({ kind: "trophy" as const, id: t.id, title: t.name, subtitle: `${t.title} (${t.platform}) · ${t.description}`, gameId: t.game_id, grade: t.grade })),
  ];
}

export function GlobalSearch() {
  const open = useApp((s) => s.searchOpen);
  const setOpen = useApp((s) => s.setSearchOpen);
  const navigate = useApp((s) => s.navigate);
  const openTrophy = useApp((s) => s.openTrophy);
  const includeSample = useApp((s) => s.settings.showSampleData);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const { data } = useQuery(() => search(term, includeSample), [term, includeSample]);
  const hits = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
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

  const choose = (h: Hit) => {
    setOpen(false);
    setTerm("");
    if (h.kind === "game") navigate("game", { gameId: h.id });
    else {
      navigate("explorer", { gameId: h.gameId });
      openTrophy(h.id);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[12vh] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="panel w-full max-w-xl overflow-hidden shadow-2xl shadow-black/60 pop-in" role="dialog" aria-modal="true" aria-label="Search games and trophies">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-fg-3" aria-hidden />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter" && hits[active]) choose(hits[active]);
            }}
            placeholder="Search games and trophies..."
            aria-label="Search games and trophies"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-results"
            className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-1.5">
          {term && hits.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-fg-3">No games or trophies match "{term}".</li>}
          {!term && <li className="px-4 py-6 text-center text-[13px] text-fg-3">Type a game or trophy name. Results come from your local library.</li>}
          {hits.map((h, i) => (
            <li key={h.kind + h.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(h)}
                className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === active ? "bg-surface-2" : "")}
              >
                {h.kind === "game" ? (
                  <GameCover url={h.cover ?? null} title={h.title} platform={h.platform ?? ""} size={30} />
                ) : (
                  <span className="flex size-[30px] items-center justify-center rounded-[5px] border border-line bg-surface-2">
                    <GradeGlyph grade={h.grade!} size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">{h.title}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">{h.subtitle}</span>
                </span>
                <span className="text-fg-3">{h.kind === "game" ? <Library className="size-3.5" /> : <Trophy className="size-3.5" />}</span>
                {i === active && <CornerDownLeft className="size-3.5 text-fg-3" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
