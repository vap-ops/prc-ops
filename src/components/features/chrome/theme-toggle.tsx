"use client";

// Spec 190 U1 — the appearance toggle on /settings. A 3-way segmented control:
// สว่าง (light) · มืด (dark) · ระบบ (follow OS). 'use client' is justified — it
// mutates the <html> class + writes the cookie on selection, and (for 'ระบบ')
// listens to the OS preference so the theme tracks it live.
//
// The initial value is passed from the server (it reads the cookie), so there's
// no flash and no hydration mismatch on the control itself. Tap targets are h-11
// (44px) — the gloved-hands floor (design doctrine).

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  type ThemeSetting,
  applyTheme,
  resolveTheme,
  setThemeCookie,
  systemPrefersDark,
} from "@/lib/ui/theme";

const OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string; icon: typeof Sun }> = [
  { value: "light", label: "สว่าง", icon: Sun },
  { value: "dark", label: "มืด", icon: Moon },
  { value: "system", label: "ระบบ", icon: Monitor },
];

export function ThemeToggle({ initial }: { initial: ThemeSetting }) {
  const [setting, setSetting] = useState<ThemeSetting>(initial);

  // While on 'ระบบ', track the OS preference live.
  useEffect(() => {
    if (setting !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setting]);

  function choose(value: ThemeSetting) {
    setSetting(value);
    setThemeCookie(value);
    applyTheme(resolveTheme(value, systemPrefersDark()));
  }

  return (
    <div
      role="group"
      aria-label="ธีมการแสดงผล"
      className="border-edge bg-card rounded-control flex gap-1 border p-1"
    >
      {OPTIONS.map((o) => {
        const active = o.value === setting;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => choose(o.value)}
            className={`rounded-control text-meta flex h-11 flex-1 items-center justify-center gap-2 font-semibold transition-colors ${
              active
                ? "bg-fill text-on-fill"
                : "text-ink-secondary hover:bg-sunk focus-visible:ring-action focus:outline-none focus-visible:ring-2"
            }`}
          >
            <Icon aria-hidden className="h-5 w-5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
