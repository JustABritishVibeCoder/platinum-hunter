/**
 * Builds the Discord Rich Presence activity from local state. Pure, so it is tested
 * without Discord. Only shows what the user opted into in Settings.
 */
export interface PresenceInput {
  session: { status: "active" | "paused"; activeMs: number } | null;
  game: { title: string; platform: string; coverUrl: string | null; hasPlatinum: boolean } | null;
  progress: { earned: number; total: number } | null;
  nextTrophy: string | null;
  options: { showProgress: boolean; showNextTrophy: boolean; showWhenIdle: boolean };
  now: Date;
}

export interface PresencePayload {
  details: string;
  state?: string;
  startMs?: number;
  largeImage?: string;
  largeText?: string;
  smallText?: string;
}

const trim = (s: string, n = 128) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildPresence(i: PresenceInput): PresencePayload | null {
  if (!i.session || !i.game) {
    return i.options.showWhenIdle ? { details: "Planning the next Platinum", smallText: "Platinum Hunter" } : null;
  }
  const g = i.game;
  const parts: string[] = [];
  if (i.session.status === "paused") parts.push("Paused");
  if (i.options.showProgress && i.progress && i.progress.total > 0) parts.push(`${i.progress.earned}/${i.progress.total} trophies`);
  if (i.options.showNextTrophy && i.nextTrophy && i.session.status === "active") parts.push(`Next: ${i.nextTrophy}`);
  const payload: PresencePayload = {
    details: trim(g.hasPlatinum ? `Hunting the ${g.title} Platinum` : `Hunting trophies in ${g.title}`),
    largeText: trim(`${g.title} (${g.platform})`),
    smallText: "Platinum Hunter",
  };
  if (parts.length) payload.state = trim(parts.join(" · "));
  // Elapsed counts active play only: start = now - active time. No timer while paused.
  if (i.session.status === "active") payload.startMs = Math.round((i.now.getTime() - i.session.activeMs) / 1000) * 1000;
  if (g.coverUrl?.startsWith("https://")) payload.largeImage = g.coverUrl;
  return payload;
}
