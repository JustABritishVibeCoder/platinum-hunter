import { useGames } from "../../app/hooks";
import { useApp, type Section } from "../../app/store";
import { inputClass } from "../../ui/primitives";

export function GamePicker({ gameId, section }: { gameId: string | null; section: Section }) {
  const games = useGames();
  const navigate = useApp((s) => s.navigate);
  if (!games.data?.length) return null;
  return (
    <select
      aria-label="Game"
      className={`${inputClass} !w-auto min-w-[260px]`}
      value={gameId ?? ""}
      onChange={(e) => navigate(section, { gameId: e.target.value })}
    >
      {games.data.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title} ({g.platform}){g.isSample ? " - SAMPLE" : ""}
        </option>
      ))}
    </select>
  );
}
