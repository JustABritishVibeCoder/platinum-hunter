import { Hand } from "lucide-react";
import { useEffect, useState } from "react";
import { setGameCounter, setGameEnding, setGameFlag, setStory } from "../../app/actions";
import type { GameBundle } from "../../domain/bundle";
import { buildProgressContext } from "../../domain/progress";
import { Badge, cx, inputClass } from "../../ui/primitives";

function CounterInput({ bundle, k, label, max, unit }: { bundle: GameBundle; k: string; label: string; max: number; unit?: string }) {
  const stored = bundle.progress.counters[k];
  const [v, setV] = useState(stored === null || stored === undefined ? "" : String(stored));
  useEffect(() => {
    setV(stored === null || stored === undefined ? "" : String(stored));
  }, [stored]);
  const commit = () => {
    const n = v === "" ? null : Math.min(max, Math.max(0, Number.parseInt(v, 10)));
    if (n !== (stored ?? null) && (n === null || Number.isFinite(n))) void setGameCounter(bundle.game.id, k, n);
  };
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12.5px] text-fg-2">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={max}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="?"
          aria-label={label}
          className={cx(inputClass, "!h-7 w-20 text-right font-mono")}
        />
        <span className="w-12 font-mono text-[11px] text-fg-3">{unit ?? `/ ${max}`}</span>
      </span>
    </label>
  );
}

function TriState({ value, onChange, label }: { value: boolean | null | undefined; onChange: (v: boolean | null) => void; label: string }) {
  const opts: [boolean | null, string][] = [
    [true, "Yes"],
    [false, "No"],
    [null, "Unknown"],
  ];
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius)] border border-line bg-elev p-0.5">
      {opts.map(([v, l]) => (
        <button
          key={l}
          role="radio"
          aria-checked={(value ?? null) === v}
          onClick={() => onChange(v)}
          className={cx("h-6 rounded-[4px] px-2 text-[11.5px]", (value ?? null) === v ? "bg-surface-3 text-fg" : "text-fg-3 hover:text-fg-2")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Editor for the player's self-reported progress. Everything here is MANUAL information. */
export function ProgressEditor({ bundle }: { bundle: GameBundle }) {
  const ctx = buildProgressContext(bundle);
  const story = bundle.meta.story;
  const cps = [...(story?.checkpoints ?? [])].sort((a, b) => a.index - b.index);
  if (!story && !bundle.meta.flags.length && !bundle.meta.counters.length) {
    return <p className="text-[12.5px] text-fg-3">No progress questions are defined for this game. Trophy statuses drive everything.</p>;
  }
  return (
    <div className="space-y-5">
      <p className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
        <Hand className="size-3.5" /> Answers here are manual progress information. They refine recommendations but never mark trophies as verified.
      </p>
      {story && (
        <div>
          <div className="label mb-2">Story progress</div>
          <select
            className={inputClass}
            value={bundle.progress.storyIndex ?? ""}
            onChange={(e) => void setStory(bundle.game.id, e.target.value === "" ? null : Number(e.target.value))}
            aria-label="Last story mission completed"
          >
            <option value="">Not set</option>
            <option value={0}>Haven't started</option>
            {cps.map((c) => (
              <option key={c.id} value={c.index}>
                Completed: {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11.5px] text-fg-3">
            {ctx.storyLower > 0 ? `Known progress: past mission #${ctx.storyLower} of ~${story.totalMissions} (from ${ctx.storyLowerBasis}).` : "No story progress known yet."} {story.orderNote}
          </p>
          {story.endings && (
            <div className="mt-3">
              <div className="mb-1.5 text-[12.5px] text-fg-2">{story.endings.question}</div>
              <select
                className={inputClass}
                value={bundle.progress.ending ?? ""}
                onChange={(e) => void setGameEnding(bundle.game.id, (e.target.value || null) as "A" | "B" | "C" | "not_reached" | null)}
                aria-label={story.endings.question}
              >
                <option value="">Unknown</option>
                <option value="not_reached">Not reached yet</option>
                {story.endings.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {ctx.removedCharacters.size > 0 && (
                <div className="mt-2">
                  <Badge tone="danger">
                    {[...ctx.removedCharacters].join(", ")} unavailable on this save
                  </Badge>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {bundle.meta.flags.length > 0 && (
        <div>
          <div className="label mb-1">Access &amp; setup</div>
          <ul className="divide-y divide-line">
            {bundle.meta.flags.map((f) => (
              <li key={f.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[12.5px] text-fg">{f.question}</span>
                  <TriState label={f.question} value={bundle.progress.flags[f.id]} onChange={(v) => void setGameFlag(bundle.game.id, f.id, v)} />
                </div>
                <p className="mt-1 text-[11.5px] text-fg-3">{f.help}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {bundle.meta.counters.length > 0 && (
        <div>
          <div className="label mb-1">Counts</div>
          <div className="grid gap-x-6 md:grid-cols-2">
            {bundle.meta.counters.map((c) => (
              <CounterInput key={c.key} bundle={bundle} k={c.key} label={c.label} max={c.max} unit={c.unit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
