import { TriangleAlert, BadgeCheck, CircleDashed, Hand, Lock, ShieldQuestionMark } from "lucide-react";
import { useEffect, useState } from "react";
import { cachedImage } from "../app/services";
import { STATE_LABEL } from "../domain/status";
import type { Grade, ResolvedStatus } from "../domain/types";
import { Badge, cx } from "./primitives";

const GRADE_COLOR: Record<Grade, string> = {
  platinum: "var(--plat)",
  gold: "var(--gold)",
  silver: "var(--silver)",
  bronze: "var(--bronze)",
};
export const GRADE_LABEL: Record<Grade, string> = { platinum: "Platinum", gold: "Gold", silver: "Silver", bronze: "Bronze" };

/** Original trophy glyph, tinted per grade. Used when no PSN icon is available. */
export function GradeGlyph({ grade, size = 20, className }: { grade: Grade; size?: number; className?: string }) {
  const c = GRADE_COLOR[grade];
  const id = `g-${grade}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={`${GRADE_LABEL[grade]} trophy`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="1" />
          <stop offset="1" stopColor={c} stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <path d="M7 3.5h10v3.2c0 3.6-2.2 6.3-5 6.3s-5-2.7-5-6.3z" fill={`url(#${id})`} />
      <path d="M7 5H4.3c0 2.7 1.4 4.4 3.6 4.8M17 5h2.7c0 2.7-1.4 4.4-3.6 4.8" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      <rect x="10.9" y="12.6" width="2.2" height="3.6" fill={c} opacity="0.8" />
      <path d="M8.2 19.8h7.6l-.8-2.6H9z" fill={c} />
      <rect x="7.2" y="19.8" width="9.6" height="1.6" rx=".5" fill={c} opacity="0.9" />
      {grade === "platinum" && <path d="M10 6.2l1 0-.7 4.6c-.7-1-.8-2.8-.3-4.6z" fill="#fff" opacity=".55" />}
    </svg>
  );
}

function useCachedImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (url) cachedImage(url).then((s) => !cancelled && setSrc(s));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return src;
}

export function TrophyIcon({ url, grade, size = 40, earned }: { url: string | null; grade: Grade; size?: number; earned?: boolean | null }) {
  const src = useCachedImage(url);
  return (
    <div
      className={cx("relative shrink-0 overflow-hidden rounded-[5px] border border-line bg-surface-2", earned === false && "opacity-80")}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className={cx("size-full object-cover", earned !== true && "grayscale-[55%]")} draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center">
          <GradeGlyph grade={grade} size={Math.round(size * 0.62)} />
        </div>
      )}
      <span className="absolute right-0 bottom-0 h-[3px] w-full" style={{ background: GRADE_COLOR[grade], opacity: earned ? 0.9 : 0.35 }} aria-hidden />
    </div>
  );
}

/** Round PSN avatar (cached for offline use), falling back to the initial. */
export function Avatar({ url, name, size = 28, className }: { url: string | null; name: string; size?: number; className?: string }) {
  const src = useCachedImage(url);
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-strong bg-surface-3", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <span className="font-display font-semibold text-fg-2" style={{ fontSize: size * 0.42 }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** Game art from PSN (cached for offline use) or a typographic cover when none exists. */
export function GameCover({ url, title, platform, size = 56, className }: { url: string | null; title: string; platform: string; size?: number; className?: string }) {
  const src = useCachedImage(url);
  const initials = title
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w && !["the", "of", "and"].includes(w.toLowerCase()))
    .slice(0, 3)
    .map((w) => (/^[IVX]+$/.test(w) ? w : w[0]))
    .join("")
    .toUpperCase();
  return (
    <div
      className={cx("relative shrink-0 overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={`${title} cover`} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full flex-col justify-between bg-[linear-gradient(150deg,var(--surface-3),var(--bg-elev))] p-[8%]">
          <span className="font-mono text-[9px] tracking-widest text-fg-3" style={{ fontSize: Math.max(8, size * 0.12) }}>
            {platform}
          </span>
          <span className="font-display leading-none font-bold text-fg/90" style={{ fontSize: size * 0.3 }}>
            {initials || "?"}
          </span>
        </div>
      )}
    </div>
  );
}

const STATE_TONE = {
  VERIFIED_EARNED: "ok",
  VERIFIED_LOCKED: "neutral",
  UNVERIFIED: "neutral",
  SYNC_ERROR: "danger",
  MANUAL: "info",
} as const;

export function StatusBadge({ status, compact }: { status: ResolvedStatus; compact?: boolean }) {
  const icon =
    status.state === "VERIFIED_EARNED" ? (
      <BadgeCheck className="size-3" />
    ) : status.state === "VERIFIED_LOCKED" ? (
      <Lock className="size-3" />
    ) : status.state === "SYNC_ERROR" ? (
      <TriangleAlert className="size-3" />
    ) : status.state === "MANUAL" ? (
      <Hand className="size-3" />
    ) : (
      <ShieldQuestionMark className="size-3" />
    );
  let label: string = STATE_LABEL[status.state];
  if (status.state === "MANUAL") label = status.earned ? "Manual · earned" : "Manual · locked";
  if (status.state === "SYNC_ERROR" && status.previous?.state) label = `Sync error · ${status.previous.state}`;
  const title = [
    status.note,
    status.confirmedAt ? `Last PSN confirmation: ${new Date(status.confirmedAt).toLocaleString()}` : null,
    status.stale ? "Verified data is stale. Sync to refresh." : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={STATE_TONE[status.state]} icon={icon} title={title || undefined}>
        {compact && status.state === "UNVERIFIED" ? "Unverified" : label}
      </Badge>
      {status.stale && status.state.startsWith("VERIFIED") && (
        <Badge tone="warn" icon={<CircleDashed className="size-3" />} title="The last successful sync is older than your staleness threshold.">
          Stale
        </Badge>
      )}
    </span>
  );
}

/** Small provenance tag: where a piece of information came from. */
export function SourceTag({ kind }: { kind: "psn" | "catalog" | "manual" | "sample" | "editorial" | "community" }) {
  const map = {
    psn: { label: "PSN", tone: "ok", title: "From PlayStation Network" },
    catalog: { label: "Dataset", tone: "neutral", title: "From the bundled, source-cited trophy dataset" },
    manual: { label: "Manual", tone: "info", title: "Entered by you" },
    sample: { label: "Sample", tone: "warn", title: "Sample data for exploring the app - not real" },
    editorial: { label: "Estimate", tone: "accent", title: "Editorial estimate, not official data" },
    community: { label: "Community", tone: "neutral", title: "Community statistic" },
  } as const;
  const m = map[kind];
  return (
    <Badge tone={m.tone} title={m.title}>
      {m.label}
    </Badge>
  );
}

export function DifficultyMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-fg-3">Unknown</span>;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Difficulty ${value} out of 10`}>
      <span className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cx("h-2.5 w-[4px] rounded-[1px]", i < Math.round(value) ? (value >= 7 ? "bg-danger" : value >= 4 ? "bg-warn" : "bg-ok") : "bg-surface-3")} />
        ))}
      </span>
      <span className="font-mono text-[12px] text-fg-2 tabular">{value}/10</span>
    </span>
  );
}
