import { TriangleAlert, CircleCheck, Info, X, CircleX } from "lucide-react";
import { useApp } from "../app/store";
import { cx } from "./primitives";

const ICON = {
  success: <CircleCheck className="size-4 text-ok" />,
  error: <CircleX className="size-4 text-danger" />,
  info: <Info className="size-4 text-info" />,
  warning: <TriangleAlert className="size-4 text-warn" />,
};

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("panel pointer-events-auto flex items-start gap-3 p-3 shadow-xl shadow-black/50 slide-in-right")}>
          <div className="mt-0.5">{ICON[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg">{t.title}</div>
            {t.body && <div className="mt-0.5 text-[12px] text-fg-2">{t.body}</div>}
            {t.action && (
              <button className="mt-1.5 text-[12px] font-medium text-accent-2 hover:underline" onClick={() => (t.action!.run(), dismiss(t.id))}>
                {t.action.label}
              </button>
            )}
          </div>
          <button aria-label="Dismiss" className="text-fg-3 hover:text-fg" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
