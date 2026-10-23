import { CircleStop, Gamepad2, Info, List, Pause, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { endSession, pauseSession, removeObjective, resumeSession, saveSessionNotes, syncGame } from "../../app/actions";
import { useBundle, useOpenSession } from "../../app/hooks";
import { usePsnEnabled, useSyncCooldown } from "../../app/psnPolicy";
import { useApp } from "../../app/store";
import { useNow } from "../../app/useQuery";
import { computeCompletion } from "../../domain/completion";
import { formatDuration, sessionDurationMs } from "../../domain/sessions";
import { formatDateTime, timeAgo } from "../../lib/external";
import { Dialog } from "../../ui/Dialog";
import { Badge, Button, EmptyState, inputClass, LoadingBlock, Panel, ProgressBar, ProgressRing } from "../../ui/primitives";
import { GameCover, GradeGlyph, StatusBadge, TrophyIcon } from "../../ui/trophy";
import { RecommendationCard } from "../recommend/RecommendationCard";

export function SessionScreen() {
  const open = useOpenSession();
  const setStart = useApp((s) => s.setStartPlayingOpen);
  const navigate = useApp((s) => s.navigate);
  const openTrophy = useApp((s) => s.openTrophy);
  const settings = useApp((s) => s.settings);
  const psn = useApp((s) => s.psn);
  const psnOn = usePsnEnabled();
  const cooldown = useSyncCooldown();
  const now = useNow();
  const o = open.data;
  const bundleQ = useBundle(o?.session.gameId);
  const bundle = bundleQ.data;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setNotes(o?.session.notes ?? "");
  }, [o?.session.id, o?.session.notes]);

  if (open.loading && !o) return <LoadingBlock rows={6} />;
  if (!o) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Gamepad2 className="size-5" />}
          title="No active session"
          body="Start a session to time your play, track objectives and attribute trophies you earn to it."
          action={
            <Button variant="primary" size="lg" icon={<Play className="size-4" />} onClick={() => setStart(true)}>
              Start Playing
            </Button>
          }
        />
      </div>
    );
  }

  const ms = sessionDurationMs(o.segments, now);
  const completion = bundle ? computeCompletion(bundle.trophies) : null;
  const playing = o.session.status === "active";
  const doEnd = () => {
    setConfirmEnd(false);
    void endSession(o.session.id, bundle?.set.id, bundle?.game.title);
  };

  return (
    <div className="space-y-5 fade-in">
      <section className="panel reticle overflow-hidden">
        <div className="flex flex-wrap items-center gap-5 p-5">
          {bundle ? <GameCover url={bundle.game.coverUrl} title={bundle.game.title} platform={bundle.game.platform} size={104} /> : <div className="size-[104px] skeleton" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {playing ? (
                <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-accent px-2 py-0.5 text-[11px] font-bold tracking-[0.14em] text-accent-ink">
                  <span className="size-1.5 rounded-full bg-accent-ink live-dot" /> PLAYING
                </span>
              ) : (
                <Badge tone="warn">Paused</Badge>
              )}
              {bundle?.game.isSample && <Badge tone="warn">Sample</Badge>}
            </div>
            <h1 className="mt-2 truncate font-display text-[26px] leading-tight font-semibold text-fg">{bundle?.game.title ?? "..."}</h1>
            <p className="mt-0.5 text-[13px] text-fg-2">
              {bundle ? `${bundle.game.platform} · ${bundle.game.edition}` : ""}
              {bundle?.set.npCommunicationId ? ` · ${bundle.set.npCommunicationId}` : ""}
            </p>
            <p className="mt-1 text-[12px] text-fg-3">Started {formatDateTime(o.session.startedAt)}</p>
          </div>
          <div className="text-right">
            <div className="label">Session time</div>
            <div className="mt-1 font-mono text-[40px] leading-none font-semibold text-fg tabular" aria-live="off">
              {formatDuration(ms, settings.sessionTimer.showSeconds)}
            </div>
            <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-fg-3" title="Measured from when you pressed Start Session. Platinum Hunter cannot see console playtime.">
              <Info className="size-3" /> Time since Start, not console playtime
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-elev px-5 py-3">
          {playing ? (
            <Button icon={<Pause className="size-4" />} onClick={() => void pauseSession(o.session.id)}>
              Pause
            </Button>
          ) : (
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void resumeSession(o.session.id)}>
              Resume
            </Button>
          )}
          <Button variant="danger" icon={<CircleStop className="size-4" />} onClick={() => (settings.sessionTimer.confirmEnd ? setConfirmEnd(true) : doEnd())}>
            End session
          </Button>
          <Button icon={<List className="size-4" />} onClick={() => navigate("explorer", { gameId: o.session.gameId })} className="ml-auto">
            View full trophy list
          </Button>
          {bundle && psnOn && (
            <Button
              icon={<RefreshCw className="size-4" />}
              disabled={!(bundle.set.bindingStatus === "bound" && psn?.connected) || !cooldown.ready}
              title={bundle.set.bindingStatus === "bound" ? (psn?.connected ? cooldown.label : "Connect PSN to sync") : "Link this game to PSN to sync"}
              onClick={() => void syncGame(bundle.set.id, bundle.game.title)}
            >
              {cooldown.ready ? "Sync now" : cooldown.label}
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">{bundle ? <RecommendationCard bundle={bundle} /> : <LoadingBlock rows={6} />}</div>
        <div className="space-y-5">
          {completion && bundle && (
            <Panel title="Trophy completion">
              <div className="flex items-center gap-4">
                <ProgressRing value={completion.percent} size={76} label={`${completion.percent}% complete`}>
                  <span className="font-mono text-[17px] font-semibold text-fg tabular">{completion.percent}%</span>
                </ProgressRing>
                <div className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
                  <div className="flex justify-between">
                    <span className="text-fg-2">Earned</span>
                    <span className="font-mono text-fg tabular">
                      {completion.earned}/{completion.total}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-fg-3">PSN-verified / manual</span>
                    <span className="font-mono text-fg-2 tabular">
                      {completion.verifiedEarned} / {completion.manualEarned}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-fg-3">Status unknown</span>
                    <span className="font-mono text-fg-2 tabular">{completion.unknown}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="inline-flex items-center gap-1.5 text-fg-2">
                    <GradeGlyph grade="platinum" size={14} /> Platinum progress
                  </span>
                  <span className="font-mono text-fg tabular">
                    {completion.platinum.requiredEarned}/{completion.platinum.requiredTotal}
                  </span>
                </div>
                <ProgressBar value={completion.platinum.requiredEarned} max={completion.platinum.requiredTotal} tone="plat" label="Platinum progress" />
              </div>
              {bundle.sync?.lastSuccessAt ? (
                <p className="mt-3 text-[11px] text-fg-3">Last PSN sync {timeAgo(bundle.sync.lastSuccessAt)}.</p>
              ) : (
                <p className="mt-3 text-[11px] text-fg-3">Not synced with PSN. Statuses are manual or unverified.</p>
              )}
            </Panel>
          )}

          <Panel title="Session objectives">
            {o.objectives.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">Use "Work on this" on a recommendation, or "Add to session objectives" on any trophy.</p>
            ) : (
              <ul className="space-y-2">
                {o.objectives.map((id) => {
                  const tv = bundle?.trophies.find((t) => t.trophy.id === id);
                  if (!tv) return null;
                  return (
                    <li key={id} className="flex items-center gap-2.5">
                      <TrophyIcon url={tv.trophy.iconUrl} grade={tv.trophy.grade} size={30} earned={tv.status.earned} />
                      <button className="min-w-0 flex-1 text-left" onClick={() => openTrophy(id)}>
                        <span className="block truncate text-[13px] text-fg">{tv.trophy.name}</span>
                        <StatusBadge status={tv.status} compact />
                      </button>
                      <button aria-label={`Remove ${tv.trophy.name} from objectives`} className="text-fg-3 hover:text-fg" onClick={() => void removeObjective(o.session.id, id)}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Session notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== o.session.notes && void saveSessionNotes(o.session.id, notes)}
              rows={4}
              placeholder="What did you work on? Saved when you click away."
              aria-label="Session notes"
              className={`${inputClass} !h-auto py-2`}
            />
          </Panel>
        </div>
      </div>

      <Dialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End this session?"
        description={`It will be saved to Session History with a duration of ${formatDuration(ms, false)}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </Button>
            <Button variant="danger" icon={<CircleStop className="size-4" />} onClick={doEnd} data-autofocus>
              End session
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">
          {settings.syncOnSessionEnd && psn?.connected && bundle?.set.bindingStatus === "bound"
            ? "Platinum Hunter will sync with PSN afterwards so trophies earned during this session can be attributed to it."
            : "Trophies you mark manually during the session are recorded as manual."}
        </p>
      </Dialog>
    </div>
  );
}
