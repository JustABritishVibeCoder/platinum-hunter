import { CircleQuestionMark } from "lucide-react";
import { useState } from "react";
import { answerQuestion } from "../../app/actions";
import type { GameBundle } from "../../domain/bundle";
import type { Question } from "../../domain/progress";
import { Button, inputClass } from "../../ui/primitives";

/** One short question that turns an "unknown" prerequisite into a known one. */
export function QuestionPrompt({ q, bundle, compact }: { q: Question; bundle: GameBundle; compact?: boolean }) {
  const gameId = bundle.game.id;
  const [num, setNum] = useState("");
  const checkpoints = [...(bundle.meta.story?.checkpoints ?? [])].sort((a, b) => a.index - b.index);
  const cp = checkpoints.find((c) => c.id === q.checkpointId);
  const prev = cp ? [...checkpoints].reverse().find((c) => c.index < cp.index) : undefined;

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--info)]/25 bg-info-soft/60 p-3">
      <div className="flex items-start gap-2">
        <CircleQuestionMark className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{q.text}</div>
          {q.help && !compact && <div className="mt-0.5 text-[12px] text-fg-2">{q.help}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {q.kind === "story" && (
              <>
                <Button size="sm" variant="primary" onClick={() => void answerQuestion(gameId, q, true, { checkpointIndex: cp?.index })}>
                  Yes, completed
                </Button>
                <Button size="sm" onClick={() => void answerQuestion(gameId, q, false, { prevCheckpointIndex: prev?.index ?? 0 })}>
                  Not yet
                </Button>
              </>
            )}
            {(q.kind === "flag" || q.kind === "trophy") && (
              <>
                <Button size="sm" variant="primary" onClick={() => void answerQuestion(gameId, q, true)}>
                  Yes
                </Button>
                <Button size="sm" onClick={() => void answerQuestion(gameId, q, false)}>
                  No
                </Button>
              </>
            )}
            {q.kind === "counter" && (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = Number.parseInt(num, 10);
                  if (Number.isFinite(v) && v >= 0) void answerQuestion(gameId, q, v);
                }}
              >
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={num}
                  onChange={(e) => setNum(e.target.value)}
                  className={`${inputClass} !h-7 w-24`}
                  aria-label={q.text}
                />
                <Button size="sm" variant="primary" type="submit" disabled={!num}>
                  Save
                </Button>
              </form>
            )}
            {q.kind === "ending" && (
              <>
                <Button size="sm" onClick={() => void answerQuestion(gameId, q, "not_reached")}>
                  Not reached yet
                </Button>
                {bundle.meta.story?.endings?.options.map((o) => (
                  <Button key={o.id} size="sm" variant={o.removes.length ? "secondary" : "primary"} onClick={() => void answerQuestion(gameId, q, o.id)}>
                    {o.label.split(":")[0]}
                  </Button>
                ))}
              </>
            )}
          </div>
          <div className="mt-1.5 text-[11px] text-fg-3">Your answer is saved as manual progress information.</div>
        </div>
      </div>
    </div>
  );
}
