import { BadgeCheck, CircleCheck, CircleX, Download, ExternalLink, KeyRound, Link2, ListChecks, PlugZap, RefreshCw, ShieldCheck, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { refreshProfile, refreshPsnStatus, syncGame } from "../../app/actions";
import { PSN_RISK_TEXT } from "../../app/features";
import { setPsnOptIn } from "../../app/actions";
import { usePsnEnabled, useSyncCooldown } from "../../app/psnPolicy";
import { getServices } from "../../app/services";
import { useApp } from "../../app/store";
import { useQuery } from "../../app/useQuery";
import { errorMessage } from "../../db/driver";
import { listGames, loadBundle } from "../../db/repo/games";
import type { GameBundle } from "../../domain/bundle";
import { openExternal, formatDateTime, timeAgo } from "../../lib/external";
import type { BindingCandidate } from "../../psn/binding";
import type { PsnTrophyTitle } from "../../psn/schemas";
import { bindingCandidates, bindSet, fetchTitles, importPsnTitle, syncLog } from "../../psn/sync";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, cx, EmptyState, ErrorState, inputClass, LoadingBlock, Panel, SectionHeader } from "../../ui/primitives";
import { Avatar, GameCover, GradeGlyph } from "../../ui/trophy";
import { tierGrade } from "../../psn/profile";

function HowItWorks() {
  return (
    <Panel title="How PSN verification works">
      <div className="space-y-3 text-[12.5px] leading-relaxed text-fg-2">
        <p>
          <span className="text-fg">Sony does not offer a public trophy API.</span> Platinum Hunter uses the same sign-in flow and trophy endpoints as the official
          PlayStation App, as documented by the community{" "}
          <button className="text-accent-2 hover:underline" onClick={() => openExternal("https://github.com/andshrew/PlayStation-Trophies")}>PlayStation-Trophies</button> project
          and used by the{" "}
          <button className="text-accent-2 hover:underline" onClick={() => openExternal("https://github.com/achievements-app/psn-api")}>psn-api</button> library.
        </p>
        <ul className="space-y-1.5">
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />Your PlayStation password is never requested. You sign in on Sony's own website.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />The NPSSO value is exchanged once for tokens and then discarded, never saved or logged.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />The refresh token is stored in Windows Credential Manager. Access tokens stay in the Rust backend's memory and never reach the interface or exports.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />Every response is validated. A failed sync never changes previously verified data.</li>
          <li className="flex gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />This interface is unofficial and undocumented by Sony. It can change or stop working at any time, and its use may not be sanctioned by Sony's terms. Requests are rate-limited conservatively.</li>
          <li className="flex gap-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />Sony only returns trophy lists for games played on your account. Sign-in typically lasts about two months before you need to reconnect.</li>
        </ul>
      </div>
    </Panel>
  );
}

function ConnectForm() {
  const toast = useApp((s) => s.toast);
  const [npsso, setNpsso] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = getServices().desktop;
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await getServices().psn.connect(npsso);
      setNpsso("");
      await refreshPsnStatus();
      void refreshProfile();
      toast({ kind: "success", title: "PSN connected", body: "You can now link games and sync verified trophy data." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Connect your account">
      <ol className="space-y-3 text-[13px]">
        <li className="flex gap-3">
          <span className="font-mono text-accent-2">01</span>
          <div>
            <div className="text-fg">Sign in to PlayStation in your web browser.</div>
            <Button size="sm" variant="ghost" className="mt-1 !px-0 text-accent-2 hover:bg-transparent" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal("https://www.playstation.com/")}>
              Open playstation.com
            </Button>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-accent-2">02</span>
          <div>
            <div className="text-fg">In the same browser, open Sony's ssocookie page and copy the 64-character <code className="font-mono text-[12px]">npsso</code> value.</div>
            <Button size="sm" variant="ghost" className="mt-1 !px-0 text-accent-2 hover:bg-transparent" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal("https://ca.account.sony.com/api/v1/ssocookie")}>
              Open ca.account.sony.com/api/v1/ssocookie
            </Button>
            <div className="text-[11.5px] text-fg-3">Treat this value like a password. Don't share it with anyone else.</div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-accent-2">03</span>
          <form className="flex-1" onSubmit={(e) => (e.preventDefault(), void connect())}>
            <div className="text-fg">Paste it here. It is exchanged immediately and not stored.</div>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={npsso}
                onChange={(e) => setNpsso(e.target.value)}
                placeholder="npsso value"
                aria-label="NPSSO value"
                className={cx(inputClass, "font-mono")}
                disabled={!desktop}
              />
              <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />} loading={busy} disabled={!npsso.trim() || !desktop}>
                Connect
              </Button>
            </div>
            {!desktop && <p className="mt-1.5 text-[12px] text-warn">PSN connection is only available in the desktop app.</p>}
          </form>
        </li>
      </ol>
      {error && <div className="mt-3"><ErrorState message={error} /></div>}
    </Panel>
  );
}

function LinkDialog({ bundle, titles, onClose }: { bundle: GameBundle; titles: PsnTrophyTitle[]; onClose: () => void }) {
  const invalidate = useApp((s) => s.invalidate);
  const toast = useApp((s) => s.toast);
  const cands = useQuery(() => bindingCandidates(getServices().db, bundle.set.id, titles), [bundle.set.id, titles]);
  const link = async (c: BindingCandidate) => {
    try {
      await bindSet(getServices().db, bundle.set.id, c.title);
      invalidate();
      onClose();
      toast({ kind: "success", title: `Linked to ${c.title.npCommunicationId}`, body: "Running the first sync now." });
      await syncGame(bundle.set.id, bundle.game.title, { firstSync: true });
    } catch (e) {
      toast({ kind: "error", title: "Could not link", body: errorMessage(e) });
    }
  };
  return (
    <Dialog open onClose={onClose} width="max-w-2xl" title={`Link ${bundle.game.title} (${bundle.game.platform})`} description="Only trophy lists matching this edition's platform and trophy service can be linked.">
      {!cands.data ? (
        <LoadingBlock rows={3} />
      ) : cands.data.length === 0 ? (
        <EmptyState icon={<Link2 className="size-5" />} title="No matching trophy list on your account" body="Sony only returns games you have started on this PSN account. Launch the game on your console once, then try again." />
      ) : (
        <ul className="space-y-2">
          {cands.data.map((c) => (
            <li key={c.title.npCommunicationId} className={cx("flex items-start gap-3 rounded-[var(--radius)] border p-3", c.accepted ? "border-accent-line bg-accent-soft" : "border-line opacity-80")}>
              <GameCover url={c.title.trophyTitleIconUrl ?? null} title={c.title.trophyTitleName} platform={c.title.trophyTitlePlatform} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium text-fg">{c.title.trophyTitleName}</span>
                  <Badge tone={c.accepted ? "accent" : "neutral"}>{c.title.trophyTitlePlatform}</Badge>
                  <Badge>{c.title.npServiceName}</Badge>
                  <span className="font-mono text-[11px] text-fg-3">{c.title.npCommunicationId}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {c.reasons.map((r, i) => (
                    <li key={i} className="flex gap-1.5 text-[12px] text-fg-2">
                      {r.startsWith("Warning") ? (
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                      ) : c.accepted ? (
                        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                      ) : (
                        <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" />
                      )}
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <Button size="sm" variant={c.accepted ? "primary" : "secondary"} disabled={!c.accepted} onClick={() => void link(c)}>
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Shown while PSN sync is off: the risk, and an explicit opt-in. */
function PsnOptIn() {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5 fade-in">
      <SectionHeader eyebrow="Integration" title="PSN Connection" subtitle="PSN sync is off. Platinum Hunter is working as a manual tracker." />
      <section className="panel reticle space-y-4 p-5">
        <div className="flex gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--warn)]/40 bg-warn-soft text-warn">
            <TriangleAlert className="size-5" />
          </div>
          <div className="space-y-2 text-[13px] text-fg-2">
            <div className="font-display text-[17px] font-semibold text-fg">Before you turn PSN sync on</div>
            <p>{PSN_RISK_TEXT}</p>
            <ul className="space-y-1">
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />At most one sync per hour (on launch, Sync now, or when a session ends). No background syncing.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />Hard limit of 20 PSN requests per hour, enforced in the app's backend.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />You sign in on Sony's site yourself and paste a fresh NPSSO. Your password is never asked for.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />Turning sync off later deletes the stored sign-in immediately.</li>
            </ul>
          </div>
        </div>
        <label className="flex items-start gap-2.5 rounded-[var(--radius)] border border-line bg-elev p-3 text-[13px] text-fg">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          I understand my PlayStation account could be locked again, and I accept that risk.
        </label>
        <Button
          variant="primary"
          disabled={!ack}
          loading={busy}
          icon={<PlugZap className="size-4" />}
          onClick={async () => {
            setBusy(true);
            await setPsnOptIn(true);
            setBusy(false);
          }}
        >
          Turn on PSN sync
        </Button>
      </section>
    </div>
  );
}

export function PsnConnection() {
  return usePsnEnabled() ? <PsnConnectionLive /> : <PsnOptIn />;
}

function PsnConnectionLive() {
  const psn = useApp((s) => s.psn);
  const profile = useApp((s) => s.profile);
  const profileError = useApp((s) => s.profileError);
  const toast = useApp((s) => s.toast);
  const invalidate = useApp((s) => s.invalidate);
  const syncing = useApp((s) => s.syncingSets);
  const [titles, setTitles] = useState<PsnTrophyTitle[] | null>(null);
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [titlesError, setTitlesError] = useState<string | null>(null);
  const [linking, setLinking] = useState<GameBundle | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const cooldown = useSyncCooldown();

  const bundles = useQuery(async () => {
    const db = getServices().db;
    const games = await listGames(db);
    return (await Promise.all(games.map((g) => loadBundle(db, g.id)))).filter((b): b is GameBundle => !!b);
  }, []);
  const log = useQuery(() => syncLog(getServices().db, 15), []);

  const loadTitles = async (): Promise<PsnTrophyTitle[] | null> => {
    setLoadingTitles(true);
    setTitlesError(null);
    try {
      const { titles: t, rejected } = await fetchTitles(getServices().psn);
      setTitles(t);
      if (rejected) toast({ kind: "warning", title: `${rejected} trophy list entries were ignored`, body: "They did not match the expected format." });
      return t;
    } catch (e) {
      setTitlesError(errorMessage(e));
      await refreshPsnStatus();
      return null;
    } finally {
      setLoadingTitles(false);
    }
  };

  const startLink = async (b: GameBundle) => {
    const t = titles ?? (await loadTitles());
    if (t) setLinking(b);
  };

  useEffect(() => {
    if (psn?.connected && !profile) void refreshProfile();
  }, [psn?.connected, profile]);

  const inLibrary = new Set((bundles.data ?? []).map((b) => b.set.npCommunicationId).filter(Boolean));

  return (
    <div className="space-y-5 fade-in">
      <SectionHeader
        eyebrow="Integration"
        title="PSN Connection"
        subtitle="Verify which trophies you have earned, directly from PlayStation Network."
        actions={
          <Button variant="danger" icon={<Unplug className="size-4" />} onClick={() => setConfirmDisconnect(true)}>
            Turn off PSN sync
          </Button>
        }
      />

      <section className="panel reticle flex flex-wrap items-center gap-4 p-5">
        {profile ? (
          <Avatar url={profile.avatarUrl} name={profile.onlineId} size={52} />
        ) : (
          <div className={cx("flex size-12 items-center justify-center rounded-full border", psn?.connected ? "border-[color:var(--ok)]/40 bg-ok-soft text-ok" : "border-line bg-surface-2 text-fg-3")}>
            <PlugZap className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-display text-[17px] font-semibold text-fg">
            {profile ? profile.onlineId : psn?.connected ? "Connected to PlayStation Network" : psn?.needsReauth ? "Sign-in expired" : "Not connected"}
          </div>
          {psn?.connected && profileError && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-warn">
              Couldn't load your profile: {profileError}
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => void refreshProfile()}>
                Retry
              </Button>
            </div>
          )}
          {profile && (
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px] text-fg-2">
              <span className="inline-flex items-center gap-1"><GradeGlyph grade={tierGrade(profile.tier)} size={14} /> Level <span className="font-mono text-fg">{profile.trophyLevel}</span> ({profile.levelProgress}% to next)</span>
              {(["platinum", "gold", "silver", "bronze"] as const).map((g) => (
                <span key={g} className="inline-flex items-center gap-1 font-mono tabular"><GradeGlyph grade={g} size={13} />{profile.earned[g]}</span>
              ))}
              {profile.isPlus && <Badge tone="warn">PS Plus</Badge>}
            </div>
          )}
          <div className="text-[12.5px] text-fg-2">
            {psn?.connected
              ? `Connected ${psn.connectedAt ? formatDateTime(new Date(psn.connectedAt * 1000).toISOString()) : ""}. Sign-in valid until ${psn.refreshExpiresAt ? formatDateTime(new Date(psn.refreshExpiresAt * 1000).toISOString()) : "unknown"}.`
              : psn?.needsReauth
                ? "Your saved sign-in has expired. Reconnect below. Your previously verified data is kept."
                : "Platinum Hunter is working as a manual tracker. Nothing is shown as PSN-verified until a sync succeeds."}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          {!psn?.connected && <ConnectForm />}

          <Panel title="Games and their PSN trophy lists">
            {!bundles.data ? (
              <LoadingBlock rows={3} />
            ) : (
              <ul className="divide-y divide-line">
                {bundles.data.map((b) => {
                  const busy = !!syncing[b.set.id];
                  return (
                    <li key={b.game.id} className="flex flex-wrap items-center gap-3 py-3">
                      <GameCover url={b.game.coverUrl} title={b.game.title} platform={b.game.platform} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium text-fg">{b.game.title}</span>
                          <Badge tone={b.game.platform === "PS5" ? "accent" : "neutral"}>{b.game.platform}</Badge>
                          {b.set.bindingStatus === "bound" ? (
                            <Badge tone="ok" icon={b.set.idsVerified ? <BadgeCheck className="size-3" /> : undefined}>{b.set.npCommunicationId}</Badge>
                          ) : (
                            <Badge>Not linked</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-fg-3">
                          Last success: {b.sync?.lastSuccessAt ? timeAgo(b.sync.lastSuccessAt) : "never"} · Last attempt: {b.sync?.lastAttemptAt ? timeAgo(b.sync.lastAttemptAt) : "never"}
                        </div>
                        {b.sync?.status === "error" && (
                          <div className="mt-0.5 text-[11.5px] text-danger">Last attempt failed: {b.sync.lastError}. Previous verified data kept.</div>
                        )}
                      </div>
                      {b.set.bindingStatus === "bound" ? (
                        <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy} disabled={!psn?.connected || !cooldown.ready} title={cooldown.label} onClick={() => void syncGame(b.set.id, b.game.title)}>
                          {!cooldown.ready ? cooldown.label : b.sync?.status === "error" ? "Retry" : "Sync now"}
                        </Button>
                      ) : (
                        <Button size="sm" variant="primary" icon={<Link2 className="size-3.5" />} disabled={!psn?.connected} loading={loadingTitles && !titles} onClick={() => void startLink(b)}>
                          Link to PSN
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {psn?.connected && (
            <Panel
              title="Your PSN trophy lists"
              actions={
                <Button size="sm" variant="ghost" icon={<ListChecks className="size-3.5" />} loading={loadingTitles} onClick={() => void loadTitles()}>
                  {titles ? "Reload" : "Load"}
                </Button>
              }
            >
              {titlesError && <ErrorState message={titlesError} onRetry={() => void loadTitles()} />}
              {!titles ? (
                <p className="text-[12.5px] text-fg-3">Load the trophy lists on your account to import other games. This makes a few requests to PSN.</p>
              ) : titles.length === 0 ? (
                <p className="text-[12.5px] text-fg-3">No trophy lists were returned for this account.</p>
              ) : (
                <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                  {titles.map((t) => (
                    <li key={t.npCommunicationId} className="flex items-center gap-3 py-2">
                      <GameCover url={t.trophyTitleIconUrl ?? null} title={t.trophyTitleName} platform={t.trophyTitlePlatform} size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] text-fg">{t.trophyTitleName}</div>
                        <div className="text-[11px] text-fg-3">
                          {t.trophyTitlePlatform} · {t.npServiceName} · {t.progress ?? 0}% · <span className="font-mono">{t.npCommunicationId}</span>
                        </div>
                      </div>
                      {inLibrary.has(t.npCommunicationId) ? (
                        <Badge tone="ok">In library</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Download className="size-3.5" />}
                          onClick={async () => {
                            try {
                              const gameId = await importPsnTitle(getServices().db, t);
                              invalidate();
                              await syncGame(`${gameId}:set`, t.trophyTitleName, { firstSync: true });
                            } catch (e) {
                              toast({ kind: "error", title: "Import failed", body: errorMessage(e) });
                            }
                          }}
                        >
                          Track
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <HowItWorks />
          <Panel title="Sync log">
            {!log.data?.length ? (
              <p className="text-[12.5px] text-fg-3">No sync attempts yet.</p>
            ) : (
              <ul className="space-y-2">
                {log.data.map((l) => (
                  <li key={l.id} className="flex gap-2 text-[12px]">
                    {l.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" />}
                    <div className="min-w-0">
                      <div className="text-fg-2">{l.message}</div>
                      <div className="text-[11px] text-fg-3">{formatDateTime(l.finished_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {linking && titles && <LinkDialog bundle={linking} titles={titles} onClose={() => setLinking(null)} />}
      <Dialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Turn off PSN sync?"
        description="Deletes the saved sign-in from Windows Credential Manager and blocks all PSN requests. Previously synced data stays, marked with its last sync time."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={<Unplug className="size-4" />}
              onClick={async () => {
                try {
                  setTitles(null);
                  setConfirmDisconnect(false);
                  await setPsnOptIn(false);
                  invalidate();
                  toast({ kind: "success", title: "PSN sync turned off", body: "The stored sign-in was deleted." });
                } catch (e) {
                  toast({ kind: "error", title: "Could not disconnect", body: errorMessage(e) });
                }
              }}
            >
              Turn off
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">You can turn it back on later with a fresh NPSSO value.</p>
      </Dialog>
    </div>
  );
}
