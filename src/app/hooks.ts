import { useMemo } from "react";
import { listGames, loadBundle } from "../db/repo/games";
import { getOpenSession, getSegments, listObjectives } from "../db/repo/sessions";
import type { GameBundle } from "../domain/bundle";
import { recommend } from "../domain/recommend";
import type { RecommendationMode } from "../domain/types";
import { getServices } from "./services";
import { useApp } from "./store";
import { useQuery } from "./useQuery";

export function useGames(includeSample?: boolean) {
  const showSample = useApp((s) => s.settings.showSampleData);
  const inc = includeSample ?? showSample;
  return useQuery(() => listGames(getServices().db, { includeSample: inc }), [inc]);
}

export function useBundle(gameId: string | null | undefined) {
  const staleHours = useApp((s) => s.settings.staleHours);
  return useQuery<GameBundle | null>(
    async () => (gameId ? loadBundle(getServices().db, gameId, { staleHours }) : null),
    [gameId, staleHours],
  );
}

export function useOpenSession() {
  return useQuery(async () => {
    const db = getServices().db;
    const s = await getOpenSession(db);
    if (!s) return null;
    return { session: s, segments: await getSegments(db, s.id), objectives: await listObjectives(db, s.id) };
  }, []);
}

/** The game the user is most likely working on. */
export function useCurrentGameId(): { gameId: string | null; loading: boolean } {
  const routeGame = useApp((s) => s.route.gameId);
  const last = useApp((s) => s.settings.lastGameId);
  const games = useGames();
  const open = useOpenSession();
  const ids = games.data?.map((g) => g.id) ?? [];
  const pick =
    (routeGame && ids.includes(routeGame) && routeGame) ||
    (open.data && ids.includes(open.data.session.gameId) && open.data.session.gameId) ||
    (last && ids.includes(last) && last) ||
    ids[0] ||
    null;
  return { gameId: pick, loading: games.loading && !games.data };
}

export function useRecommendations(bundle: GameBundle | null | undefined, mode: RecommendationMode) {
  const includeOptional = useApp((s) => s.settings.includeOptionalTrophies);
  return useMemo(() => (bundle ? recommend(bundle, mode, { includeOptional }) : null), [bundle, mode, includeOptional]);
}
