import { invoke } from "@tauri-apps/api/core";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { applyAppearance, updateSettings } from "../../app/actions";
import { isTauri } from "../../db/tauriDriver";
import { Button } from "../../ui/primitives";
import { BrandMark } from "../shell/Sidebar";

/** First-run "Who's playing?" screen. Suggests the Windows account name. */
export function Welcome() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Preview the PlayStation 5 look straight away.
    applyAppearance({ theme: "ps5", accent: "violet" });
    if (isTauri()) {
      invoke<string | null>("system_user_name")
        .then((n) => n && setName((cur) => cur || n))
        .catch(() => undefined);
    }
  }, []);

  const save = async () => {
    setSaving(true);
    await updateSettings({ displayName: name.trim() || "Player", theme: "ps5" });
    setSaving(false);
  };

  const initial = (name.trim() || "P").slice(0, 1).toUpperCase();
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 fade-in">
      <div className="flex items-center gap-3">
        <BrandMark size={40} />
        <div className="leading-none">
          <div className="font-display text-[18px] font-bold tracking-[0.16em] text-fg">PLATINUM</div>
          <div className="mt-1 font-display text-[12px] font-medium tracking-[0.46em] text-accent-2">HUNTER</div>
        </div>
      </div>
      <h1 className="mt-14 font-display text-[34px] font-light tracking-tight text-fg">Who's playing?</h1>
      <form className="mt-8 flex w-full max-w-sm flex-col items-center" onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}>
        <div className="flex size-28 items-center justify-center rounded-full bg-[linear-gradient(145deg,var(--accent),#7a4cf0)] font-display text-[44px] font-semibold text-white shadow-[0_0_0_4px_var(--bg),0_0_0_6px_var(--accent-line),0_18px_40px_rgb(47_127_247/0.35)]">
          {initial}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="Enter your name"
          aria-label="Your name"
          className="mt-6 h-12 w-full rounded-full border border-line-strong bg-elev px-5 text-center text-[16px] text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-4 focus:ring-accent-soft"
        />
        <Button type="submit" variant="primary" size="lg" loading={saving} className="mt-5 !rounded-full !px-8" icon={<ArrowRight className="size-4" />}>
          Continue
        </Button>
        <p className="mt-4 text-center text-[12px] text-fg-3">Shown on your home screen. Stored only on this PC; change it any time in Settings.</p>
      </form>
    </div>
  );
}
