import { isTauri } from "../db/tauriDriver";

/** Opens an https link in the user's default browser. Other schemes are refused. */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "https:") return;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(parsed.toString());
  } else {
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  }
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  const s = Math.round(ms / 1000);
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
