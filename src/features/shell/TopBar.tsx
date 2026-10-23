import { ArrowLeft, RefreshCw, Search, Trophy, TriangleAlert } from "lucide-react";
import { syncEverything } from "../../app/actions";
import { usePsnEnabled, useSyncCooldown } from "../../app/psnPolicy";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { Button, IconButton, Kbd } from "../../ui/primitives";
import { ProfileChip } from "./ProfileChip";

export function TopBar() {
  const setSearch = useApp((s) => s.setSearchOpen);
  const psn = useApp((s) => s.psn);
  const syncing = useApp((s) => s.syncingSets["*"]);
  const psnOn = usePsnEnabled();
  const cooldown = useSyncCooldown();
  const history = useApp((s) => s.history);
  const back = useApp((s) => s.back);
  const desktop = getServices().desktop;
  const setQuickEarn = useApp((s) => s.setQuickEarnOpen);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-5 backdrop-blur">
      <IconButton label="Back" onClick={back} disabled={!history.length}>
        <ArrowLeft className="size-4" />
      </IconButton>
      <button
        onClick={() => setSearch(true)}
        className="flex h-8.5 w-full max-w-md items-center gap-2.5 rounded-[var(--radius)] border border-line bg-elev px-3 text-[13px] text-fg-3 transition-colors hover:border-line-strong"
        aria-label="Search games and trophies (Ctrl+K)"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search games and trophies</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        {!desktop && (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--warn)]/30 bg-warn-soft px-2.5 py-1 text-[11.5px] text-warn" title="Running in a browser preview: an in-memory database is used and nothing is saved. PSN is unavailable.">
            <TriangleAlert className="size-3.5" />
            Browser preview: data is not saved
          </span>
        )}
        {psnOn && psn?.connected && (
          <Button size="sm" variant="secondary" loading={!!syncing} disabled={!cooldown.ready} title={cooldown.ready ? "Sync linked games with PSN (once per hour)" : cooldown.label} icon={<RefreshCw className="size-3.5" />} onClick={() => void syncEverything()}>
            {cooldown.ready ? "Sync all" : cooldown.label}
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={<Trophy className="size-3.5 text-gold" />} onClick={() => setQuickEarn(true)} title="Log a trophy you just earned (Ctrl+E)">
          I just earned…
        </Button>
        <ProfileChip />
      </div>
    </header>
  );
}
