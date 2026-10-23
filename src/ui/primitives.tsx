import { TriangleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]",
  secondary: "bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong",
  outline: "border border-line-strong text-fg hover:bg-surface-2",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
  danger: "bg-danger-soft text-danger border border-[color:var(--danger)]/30 hover:bg-[color:var(--danger)]/20",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8.5 px-3.5 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] font-medium whitespace-nowrap transition-[background,filter,border-color,color] duration-150 disabled:pointer-events-none disabled:opacity-45 cursor-default",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-8 items-center justify-center rounded-[var(--radius)] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-2 border-line",
  accent: "bg-accent-soft text-accent-2 border-accent-line",
  ok: "bg-ok-soft text-ok border-[color:var(--ok)]/30",
  warn: "bg-warn-soft text-warn border-[color:var(--warn)]/30",
  danger: "bg-danger-soft text-danger border-[color:var(--danger)]/30",
  info: "bg-info-soft text-info border-[color:var(--info)]/30",
};

export function Badge({ tone = "neutral", icon, children, title, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-[4px] border px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function ProgressBar({ value, max = 100, tone = "accent", className, label }: { value: number; max?: number; tone?: "accent" | "ok" | "plat"; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === "ok" ? "bg-ok" : tone === "plat" ? "bg-plat" : "bg-accent";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 64, stroke = 5, children, label }: { value: number; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${pct}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius)] border border-line bg-elev p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-[4px] font-medium transition-colors",
            size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-3 text-xs",
            value === o.value ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--border-strong)]" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-[22px] leading-tight font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, bodyClassName, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section className={cx("panel", className)} aria-labelledby={id}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          {title && (
            <h2 id={id} className="label !text-fg-2">
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={cx("mt-1 font-mono text-[22px] leading-none font-semibold tabular", accent ? "text-accent-2" : "text-fg")}>{value}</div>
      {hint && <div className="mt-1.5 truncate text-[11.5px] text-fg-3">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center fade-in">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full border border-line bg-surface-2 text-fg-3">{icon}</div>
      <div className="font-display text-[15px] font-semibold text-fg">{title}</div>
      {body && <div className="mt-1 max-w-md text-[13px] text-fg-2">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--danger)]/30 bg-danger-soft p-3 text-[13px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 text-fg">{message}</div>
      {onRetry && (
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-fg-2">{children}</kbd>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11.5px] text-fg-3">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "h-8.5 w-full rounded-[var(--radius)] border border-line bg-elev px-3 text-[13px] text-fg placeholder:text-fg-3 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-default items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-[12px] text-fg-3">{description}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line-strong bg-surface-3",
        )}
      >
        <span className={cx("inline-block size-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-[2px]")} />
      </button>
    </label>
  );
}
