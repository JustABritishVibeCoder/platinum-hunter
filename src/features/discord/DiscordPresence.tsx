import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef } from "react";
import { useBundle, useOpenSession, useRecommendations } from "../../app/hooks";
import { useApp } from "../../app/store";
import { useNow } from "../../app/useQuery";
import { isTauri } from "../../db/tauriDriver";
import { computeCompletion } from "../../domain/completion";
import { buildPresence } from "../../domain/presence";
import { sessionDurationMs } from "../../domain/sessions";

/**
 * Keeps Discord Rich Presence in sync with the active session. Updates are sent only
 * when the activity actually changes (Discord allows ~5 updates per 20 s), and the
 * connection is retried every minute if Discord isn't running.
 */
export function DiscordPresence() {
  const cfg = useApp((s) => s.settings.discord);
  const mode = useApp((s) => s.settings.defaultMode);
  const setStatus = useApp((s) => s.setDiscord);
  const open = useOpenSession();
  const session = open.data;
  const bundle = useBundle(session?.session.gameId).data;
  const rec = useRecommendations(bundle, mode);
  const now = useNow();
  const minute = Math.floor(now.getTime() / 60_000);
  const lastSent = useRef<string | null>(null);

  const payload = useMemo(() => {
    if (!cfg.enabled) return null;
    const plat = bundle ? computeCompletion(bundle.trophies).platinum : null;
    const focus = bundle?.focusTrophyId ? bundle.trophies.find((t) => t.trophy.id === bundle.focusTrophyId)?.trophy.name : null;
    return buildPresence({
      session: session && session.session.status !== "ended" ? { status: session.session.status, activeMs: sessionDurationMs(session.segments) } : null,
      game: bundle ? { title: bundle.game.title, platform: bundle.game.platform, coverUrl: bundle.game.coverUrl, hasPlatinum: !!plat?.exists } : null,
      progress: plat?.exists ? { earned: plat.requiredEarned, total: plat.requiredTotal } : null,
      nextTrophy: focus ?? rec?.ranked[0]?.trophy.trophy.name ?? null,
      options: cfg,
      now: new Date(),
    });
    // Recompute when inputs change; `minute` lets a failed connection retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, session, bundle, rec, minute]);

  useEffect(() => {
    if (!isTauri()) return;
    if (!cfg.enabled) {
      if (lastSent.current !== null) void invoke("discord_clear").catch(() => undefined);
      lastSent.current = null;
      setStatus("off");
      return;
    }
    if (!cfg.applicationId) {
      setStatus("needs_id");
      return;
    }
    const key = JSON.stringify(payload);
    if (key === lastSent.current) return;
    const id = window.setTimeout(() => {
      const send = payload ? invoke("discord_update", { applicationId: cfg.applicationId, payload }) : invoke("discord_clear");
      send
        .then(() => {
          lastSent.current = key;
          setStatus("connected");
        })
        .catch(() => {
          lastSent.current = null; // retry on the next change or minute tick
          setStatus("unavailable");
        });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [payload, cfg.enabled, cfg.applicationId, setStatus, minute]);

  // Clear the activity when the app closes.
  useEffect(() => {
    const clear = () => void invoke("discord_clear").catch(() => undefined);
    window.addEventListener("beforeunload", clear);
    return () => window.removeEventListener("beforeunload", clear);
  }, []);

  return null;
}
