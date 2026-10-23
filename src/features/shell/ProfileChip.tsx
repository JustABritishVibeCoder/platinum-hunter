import { PlugZap } from "lucide-react";
import { usePsnEnabled } from "../../app/psnPolicy";
import { useApp } from "../../app/store";
import { tierGrade } from "../../psn/profile";
import { Button, cx } from "../../ui/primitives";
import { Avatar, GradeGlyph } from "../../ui/trophy";

/** The connected PSN account at a glance: avatar, online ID and trophy level. */
export function ProfileChip() {
  const profile = useApp((s) => s.profile);
  const psn = useApp((s) => s.psn);
  const navigate = useApp((s) => s.navigate);
  const psnOn = usePsnEnabled();

  if (!psnOn) return null;
  if (!profile) {
    return psn?.connected ? null : (
      <Button size="sm" variant="ghost" icon={<PlugZap className="size-3.5" />} onClick={() => navigate("psn")}>
        Connect PSN
      </Button>
    );
  }
  const grade = tierGrade(profile.tier);
  return (
    <button
      onClick={() => navigate("psn")}
      className="flex items-center gap-2.5 rounded-full border border-line bg-elev py-1 pr-3.5 pl-1 transition-colors hover:border-line-strong"
      title={`${profile.onlineId} · Level ${profile.trophyLevel} (${profile.levelProgress}% to next)${psn?.connected ? "" : " · PSN not connected, showing cached profile"}`}
      aria-label={`PSN profile ${profile.onlineId}, trophy level ${profile.trophyLevel}`}
    >
      <span className="relative">
        <Avatar url={profile.avatarUrl} name={profile.onlineId} size={28} />
        <span
          className={cx("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-elev", psn?.connected ? "bg-ok" : psn?.needsReauth ? "bg-warn" : "bg-fg-3")}
          aria-hidden
        />
      </span>
      <span className="text-left leading-tight">
        <span className="block max-w-[150px] truncate text-[12.5px] font-medium text-fg">{profile.onlineId}</span>
        <span className="flex items-center gap-1 text-[11px] text-fg-3">
          <GradeGlyph grade={grade} size={12} />
          <span className="font-mono tabular">Lv {profile.trophyLevel}</span>
          {profile.isPlus && <span className="ml-1 rounded-[3px] bg-[color:var(--gold)]/15 px-1 text-[9.5px] font-bold text-gold">PLUS</span>}
        </span>
      </span>
    </button>
  );
}
