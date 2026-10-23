import { invoke } from "@tauri-apps/api/core";
import { Database, Download, ExternalLink, FileUp, HardDrive, RotateCcw, ShieldAlert, Upload } from "lucide-react";
import { openExternal } from "../../lib/external";
import { useState, type ReactNode } from "react";
import { updateSettings } from "../../app/actions";
import { usePsnEnabled } from "../../app/psnPolicy";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { errorMessage } from "../../db/driver";
import { checkImport, exportData, importData, TABLE_COLUMNS, type ImportCheck } from "../../db/repo/exportImport";
import { removedCatalogs, restoreCatalog, syncBundledCatalogs } from "../../db/repo/library";
import { hasSampleData, installSampleData, removeSampleData } from "../../db/repo/sample";
import type { Settings as SettingsT } from "../../db/repo/settings";
import { LATEST_SCHEMA_VERSION, migrate } from "../../db/migrations";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, cx, inputClass, Panel, SectionHeader, Segmented, Toggle } from "../../ui/primitives";

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-fg-3">{description}</div>}
      </div>
      {children}
    </div>
  );
}

const ACCENTS: { id: SettingsT["accent"]; color: string; label: string }[] = [
  { id: "violet", color: "#8b5cf6", label: "Violet" },
  { id: "indigo", color: "#6d72f3", label: "Indigo" },
  { id: "orchid", color: "#c264e8", label: "Orchid" },
  { id: "ice", color: "#5fb4e6", label: "Ice" },
];

async function pickSavePath(defaultPath: string, ext: string, name: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters: [{ name, extensions: [ext] }] });
}
async function pickOpenPath(ext: string, name: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory: false, filters: [{ name, extensions: [ext] }] });
  return typeof r === "string" ? r : null;
}

function DataManagement() {
  const toast = useApp((s) => s.toast);
  const invalidate = useApp((s) => s.invalidate);
  const desktop = getServices().desktop;
  const [pendingImport, setPendingImport] = useState<ImportCheck | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const info = useQuery(async () => (desktop ? invoke<{ path: string; sizeBytes: number }>("db_info") : null), []);
  const stamp = new Date().toISOString().slice(0, 10);

  const guard = async (key: string, fn: () => Promise<void>, fail: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ kind: "error", title: fail, body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Data">
      {!desktop && <p className="mb-3 text-[12px] text-warn">File operations are only available in the desktop app.</p>}
      <div className="divide-y divide-line">
        <Row label="Export data (JSON)" description="All games, statuses, sessions and settings. Contains no PSN credentials (they live only in Windows Credential Manager).">
          <Button icon={<Download className="size-4" />} disabled={!desktop} loading={busy === "export"} onClick={() => guard("export", async () => {
            const path = await pickSavePath(`platinum-hunter-export-${stamp}.json`, "json", "Platinum Hunter export");
            if (!path) return;
            const data = await exportData(getServices().db);
            await invoke("file_write_text", { path, contents: JSON.stringify(data, null, 2) });
            toast({ kind: "success", title: "Export saved", body: path });
          }, "Export failed")}>Export</Button>
        </Row>
        <Row label="Import data (JSON)" description="Replaces all local data with an export file after validating it. A safety backup is taken first.">
          <Button icon={<FileUp className="size-4" />} disabled={!desktop} loading={busy === "import"} onClick={() => guard("import", async () => {
            const path = await pickOpenPath("json", "Platinum Hunter export");
            if (!path) return;
            const text = await invoke<string>("file_read_text", { path });
            setPendingImport(checkImport(text));
          }, "Could not read file")}>Import</Button>
        </Row>
        <Row label="Back up database" description="A full copy of the SQLite database, safe to take while the app is running.">
          <Button icon={<HardDrive className="size-4" />} disabled={!desktop} loading={busy === "backup"} onClick={() => guard("backup", async () => {
            const path = await pickSavePath(`platinum-hunter-backup-${stamp}.db`, "db", "SQLite database");
            if (!path) return;
            await invoke("db_backup", { destPath: path });
            toast({ kind: "success", title: "Backup saved", body: path });
          }, "Backup failed")}>Back up</Button>
        </Row>
        <Row label="Restore database" description="Validates the backup (integrity, origin, version), saves a safety copy of the current data, then restores.">
          <Button icon={<Upload className="size-4" />} disabled={!desktop} onClick={() => guard("restore-pick", async () => {
            const path = await pickOpenPath("db", "SQLite database");
            if (path) setPendingRestore(path);
          }, "Could not open file")}>Restore</Button>
        </Row>
        <Row label="Reset local data" description="Deletes all games, statuses, sessions and answers. The GTA V (PS5) dataset is reinstalled. A safety backup is taken first.">
          <Button variant="danger" icon={<ShieldAlert className="size-4" />} onClick={() => setResetOpen(true)}>Reset…</Button>
        </Row>
      </div>
      {info.data && (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-fg-3">
          <Database className="size-3.5" /> {info.data.path} · {(info.data.sizeBytes / 1024).toFixed(0)} KB · schema v{LATEST_SCHEMA_VERSION}
        </p>
      )}

      <Dialog
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        title={pendingImport?.ok ? "Replace all data with this export?" : "This file can't be imported"}
        footer={
          pendingImport?.ok ? (
            <>
              <Button variant="ghost" onClick={() => setPendingImport(null)}>Cancel</Button>
              <Button variant="danger" loading={busy === "apply-import"} onClick={() => guard("apply-import", async () => {
                const backup = await invoke<string>("db_safety_backup", { label: "pre-import" });
                await importData(getServices().db, pendingImport!.file!);
                await migrate(getServices().db);
                setPendingImport(null);
                invalidate();
                toast({ kind: "success", title: "Import complete", body: `Safety backup: ${backup}` });
              }, "Import failed; your data was not changed")}>Replace data</Button>
            </>
          ) : (
            <Button onClick={() => setPendingImport(null)}>Close</Button>
          )
        }
      >
        {pendingImport?.ok ? (
          <div className="text-[12.5px] text-fg-2">
            <p>Exported {pendingImport.file!.exportedAt}. Contents:</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 font-mono text-[11.5px]">
              {Object.keys(TABLE_COLUMNS).filter((t) => pendingImport.summary?.[t]).map((t) => (
                <li key={t} className="flex justify-between"><span>{t}</span><span className="text-fg">{pendingImport.summary![t]}</span></li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-danger">
            {pendingImport?.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={!!pendingRestore}
        onClose={() => setPendingRestore(null)}
        title="Restore this backup?"
        description={pendingRestore ?? ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === "restore"} onClick={() => guard("restore", async () => {
              await invoke<number>("db_restore", { srcPath: pendingRestore, maxSchemaVersion: LATEST_SCHEMA_VERSION });
              await migrate(getServices().db);
              await syncBundledCatalogs(getServices().db);
              setPendingRestore(null);
              invalidate();
              toast({ kind: "success", title: "Backup restored", body: "A copy of your previous data was saved in the app's backups folder." });
            }, "Restore failed; your current data is unchanged")}>Restore</Button>
          </>
        }
      >
        <p className="text-[12.5px] text-fg-2">Your current database will be replaced. A safety copy is written first.</p>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset all local data?"
        description="This cannot be undone from inside the app (a safety backup file is kept)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={resetText !== "RESET"} loading={busy === "reset"} onClick={() => guard("reset", async () => {
              const db = getServices().db;
              if (desktop) await invoke<string>("db_safety_backup", { label: "pre-reset" });
              const tables = Object.keys(TABLE_COLUMNS).filter((t) => t !== "settings").reverse();
              await db.batch([...tables.map((t) => ({ sql: `DELETE FROM ${t}` })), { sql: "DELETE FROM app_meta WHERE key LIKE 'catalog_removed:%'" }]);
              await syncBundledCatalogs(db);
              setResetOpen(false);
              setResetText("");
              invalidate();
              toast({ kind: "success", title: "Local data reset" });
            }, "Reset failed")}>Reset everything</Button>
          </>
        }
      >
        <p className="mb-2 text-[12.5px] text-fg-2">Type <span className="font-mono text-fg">RESET</span> to confirm. Settings and your PSN sign-in are kept.</p>
        <input className={inputClass} value={resetText} onChange={(e) => setResetText(e.target.value)} aria-label="Type RESET to confirm" data-autofocus />
      </Dialog>
    </Panel>
  );
}

function NameInput() {
  const current = useApp((st) => st.settings.displayName) ?? "";
  const [v, setV] = useState(current);
  return (
    <input
      className={`${inputClass} !w-48`}
      value={v}
      maxLength={40}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v.trim() !== current && void updateSettings({ displayName: v.trim() })}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      aria-label="Your name"
    />
  );
}

function DiscordPanel() {
  const s = useApp((st) => st.settings.discord);
  const status = useApp((st) => st.discord);
  const [id, setId] = useState(s.applicationId);
  const valid = /^\d{15,21}$/.test(id.trim());
  const set = (patch: Partial<SettingsT["discord"]>) => void updateSettings({ discord: { ...s, ...patch } });
  const statusText = {
    off: { text: "Off", tone: "text-fg-3" },
    connected: { text: "Showing on your Discord profile", tone: "text-ok" },
    unavailable: { text: "Discord isn't running (retrying every minute)", tone: "text-warn" },
    needs_id: { text: "Add your Application ID to start", tone: "text-warn" },
  }[status];
  return (
    <Panel title="Discord Rich Presence">
      <Toggle
        label="Show what I'm hunting on Discord"
        description="Shares your current game, Platinum progress and session timer with your Discord friends, via the Discord desktop app on this PC."
        checked={s.enabled}
        onChange={(v) => set({ enabled: v })}
      />
      <div className={cx("mb-2 text-[12px]", statusText.tone)}>{statusText.text}</div>
      <div className="space-y-1.5 rounded-[var(--radius)] border border-line bg-elev p-3 text-[12px] text-fg-2">
        <div className="font-medium text-fg">One-time setup (about a minute)</div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>
            Open the{" "}
            <button className="inline-flex items-center gap-0.5 text-accent-2 hover:underline" onClick={() => openExternal("https://discord.com/developers/applications")}>
              Discord Developer Portal <ExternalLink className="size-3" />
            </button>{" "}
            and create a New Application named <span className="text-fg">Platinum Hunter</span>. Discord shows this name as "Playing Platinum Hunter".
          </li>
          <li>Copy its <span className="text-fg">Application ID</span> from General Information and paste it below. It is a public ID, not a password.</li>
        </ol>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className={cx(inputClass, "font-mono")}
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\s/g, ""))}
          placeholder="Application ID, e.g. 1234567890123456789"
          aria-label="Discord Application ID"
          inputMode="numeric"
        />
        <Button variant="primary" disabled={!valid || id.trim() === s.applicationId} onClick={() => set({ applicationId: id.trim() })}>
          Save
        </Button>
      </div>
      {id && !valid && <p className="mt-1 text-[11.5px] text-warn">Application IDs are 15-21 digits.</p>}
      <div className="mt-2">
        <Toggle label="Show Platinum progress" checked={s.showProgress} onChange={(v) => set({ showProgress: v })} />
        <Toggle label="Show the trophy I'm working on" checked={s.showNextTrophy} onChange={(v) => set({ showNextTrophy: v })} />
        <Toggle label="Show presence when no session is running" checked={s.showWhenIdle} onChange={(v) => set({ showWhenIdle: v })} />
      </div>
    </Panel>
  );
}

function LibraryOptions() {
  const toast = useApp((s) => s.toast);
  const invalidate = useApp((s) => s.invalidate);
  const settings = useApp((s) => s.settings);
  const sample = useQuery(() => hasSampleData(getServices().db), []);
  const removed = useQuery(() => removedCatalogs(getServices().db), []);
  return (
    <Panel title="Library">
      <Toggle
        label="Show sample data"
        description="Adds a clearly-labelled fictional game with demo sessions so you can explore. Never mixed into statistics."
        checked={settings.showSampleData}
        onChange={async (on) => {
          try {
            if (on) await installSampleData(getServices().db);
            else await removeSampleData(getServices().db);
            await updateSettings({ showSampleData: on });
            invalidate();
          } catch (e) {
            toast({ kind: "error", title: "Could not update sample data", body: errorMessage(e) });
          }
        }}
      />
      {sample.data && !settings.showSampleData && <p className="text-[11.5px] text-fg-3">Sample data exists but is hidden.</p>}
      {(removed.data ?? []).map((c) => (
        <Row key={c.id} label={`${c.title} (${c.platform}) dataset removed`} description="Re-add the bundled, source-cited trophy dataset.">
          <Button icon={<RotateCcw className="size-4" />} onClick={async () => { await restoreCatalog(getServices().db, c.id); invalidate(); }}>Re-add</Button>
        </Row>
      ))}
    </Panel>
  );
}

export function SettingsPage() {
  const s = useApp((st) => st.settings);
  const psnOn = usePsnEnabled();
  const set = (patch: Partial<SettingsT>) => void updateSettings(patch);
  return (
    <div className="space-y-5 fade-in">
      <SectionHeader eyebrow="Preferences" title="Settings" subtitle="Saved locally. Nothing here is sent anywhere." />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Panel title="Appearance">
            <Row label="Theme">
              <Segmented label="Theme" value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: "ps5", label: "PlayStation 5" }, { value: "midnight", label: "Midnight" }, { value: "graphite", label: "Graphite" }, { value: "oled", label: "OLED" }]} />
            </Row>
            <Row label="Your name" description={"Shown as \"Welcome back, …\" on the home screen."}>
              <NameInput />
            </Row>
            <Row label="Accent colour" description={s.theme === "ps5" ? "The PlayStation 5 theme uses its own blue accent." : undefined}>
              <div className="flex gap-2" role="radiogroup" aria-label="Accent colour">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={s.accent === a.id}
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => set({ accent: a.id })}
                    className={cx("size-7 rounded-full border-2 transition-transform", s.accent === a.id ? "scale-110 border-fg" : "border-transparent")}
                    style={{ background: a.color }}
                  />
                ))}
              </div>
            </Row>
          </Panel>

          <Panel title="Recommendations">
            <Row label="Default mode">
              <Segmented label="Default recommendation mode" value={s.defaultMode} onChange={(defaultMode) => set({ defaultMode })} options={[{ value: "easiest", label: "Easiest" }, { value: "quickest", label: "Quickest" }, { value: "best_progress", label: "Best progress" }]} />
            </Row>
            <Toggle label="Include add-on trophies" description="Recommend trophies outside the Platinum's required group too." checked={s.includeOptionalTrophies} onChange={(v) => set({ includeOptionalTrophies: v })} />
            <Row label="Skip duration" description="How long a skipped trophy is deprioritised.">
              <select className={`${inputClass} !w-32`} value={s.skipHours} onChange={(e) => set({ skipHours: Number(e.target.value) })} aria-label="Skip duration">
                {[4, 12, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}</option>)}
              </select>
            </Row>
            <Row label="Default platform" description="Preselected when an edition choice is needed.">
              <select className={`${inputClass} !w-32`} value={s.defaultPlatform} onChange={(e) => set({ defaultPlatform: e.target.value as SettingsT["defaultPlatform"] })} aria-label="Default platform">
                {["PS5", "PS4", "PS3", "PSVITA", "PSVR", "PSVR2", "PC"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Row>
          </Panel>

          <Panel title="Sessions">
            <Toggle label="Show seconds on timer" checked={s.sessionTimer.showSeconds} onChange={(v) => set({ sessionTimer: { ...s.sessionTimer, showSeconds: v } })} />
            <Toggle label="Confirm before ending a session" checked={s.sessionTimer.confirmEnd} onChange={(v) => set({ sessionTimer: { ...s.sessionTimer, confirmEnd: v } })} />
            <p className="mt-1 text-[11.5px] text-fg-3">The timer is computed from saved timestamps, so it stays correct if you close the app or your PC sleeps.</p>
          </Panel>
        </div>

        <div className="space-y-5">
          {psnOn && (
          <Panel title="PSN sync">
            <Toggle label="Sync on launch" description="One sync when the app starts, if connected and at least an hour has passed." checked={s.syncOnLaunch} onChange={(v) => set({ syncOnLaunch: v })} />
            <Toggle label="Sync when a session ends" description="Only if at least an hour has passed since the last sync." checked={s.syncOnSessionEnd} onChange={(v) => set({ syncOnSessionEnd: v })} />
            <p className="py-2 text-[12px] text-fg-3">Platinum Hunter syncs at most once an hour and never in the background, to keep PSN requests to a minimum.</p>
            <Row label="Mark verified data stale after" description="Older verified results are flagged as stale.">
              <select className={`${inputClass} !w-36`} value={s.staleHours} onChange={(e) => set({ staleHours: Number(e.target.value) })} aria-label="Stale threshold">
                {[6, 12, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}</option>)}
              </select>
            </Row>
          </Panel>
          )}

          <DiscordPanel />

          <Panel title="Notifications">
            <Toggle label="Trophy confirmed by PSN" checked={s.notifications.trophyEarned} onChange={(v) => set({ notifications: { ...s.notifications, trophyEarned: v } })} />
            <Toggle label="Sync errors" checked={s.notifications.syncErrors} onChange={(v) => set({ notifications: { ...s.notifications, syncErrors: v } })} />
            <Toggle label="Missable warnings on the dashboard" checked={s.notifications.missableWarnings} onChange={(v) => set({ notifications: { ...s.notifications, missableWarnings: v } })} />
          </Panel>

          <LibraryOptions />
          <DataManagement />

          <Panel title="About">
            <div className="space-y-1 text-[12px] text-fg-2">
              <div className="flex items-center gap-2"><span className="text-fg">Platinum Hunter 1.0.0</span><Badge>Schema v{LATEST_SCHEMA_VERSION}</Badge></div>
              <p>Not affiliated with or endorsed by Sony Interactive Entertainment or Rockstar Games. PlayStation and PSN are trademarks of Sony Interactive Entertainment.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
