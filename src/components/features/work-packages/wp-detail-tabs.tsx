"use client";

// Spec 167 — WP detail segmented tabs. The detail page was one long scroll
// mixing capture · purchases · labor · info (+ a planner management block above
// the hero). This client switcher renders a WAI-ARIA tablist and shows ONE
// panel at a time, with the always-relevant chrome (header, progress bar,
// attention/defect) pinned by the page above it.
//
// Why every panel stays MOUNTED (hidden, not unmounted):
//   - the page does ONE server fetch (spec 147 loadWorkPackageDetail); a per-tab
//     ?tab= navigation would re-run that loader on every tap.
//   - panels hold live form state (a half-typed purchase request, labor rows) —
//     unmounting would discard it on a stray tab tap.
// So inactive panels get `hidden` (display:none) — same DOM as today, focused.
//
// 'use client' is justified: the active-tab state + the hashchange deep link.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export interface WpDetailTab {
  key: string;
  label: ReactNode;
  panel: ReactNode;
}

export function WpDetailTabs({
  tabs,
  hashTabMap,
}: {
  tabs: WpDetailTab[];
  hashTabMap?: Record<string, string>;
}) {
  const baseId = useId();
  const [active, setActive] = useState(() => tabs[0]?.key ?? "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Deep link: a pinned chip targets #wp-requests; map the hash to a tab so a
  // tap on the pending-requests chip opens คำขอซื้อ instead of an anchor scroll.
  // Read on mount and on every hashchange.
  useEffect(() => {
    if (!hashTabMap) return;
    const apply = () => {
      const h = window.location.hash.replace(/^#/, "");
      const target = hashTabMap[h];
      if (target && tabs.some((t) => t.key === target)) setActive(target);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [hashTabMap, tabs]);

  // Arrow / Home / End roving focus across the tablist (WAI-ARIA tabs).
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const t = tabs[next];
    if (!t) return;
    setActive(t.key);
    tabRefs.current[t.key]?.focus();
  }

  return (
    <>
      {/* Full-bleed tab bar — matches the pinned progress-bar row above it. */}
      <div className="border-edge bg-card border-b px-5">
        <div role="tablist" aria-label="ส่วนต่าง ๆ ของงาน" className={`mx-auto flex ${PAGE_MAX_W}`}>
          {tabs.map((t, i) => {
            const isActive = t.key === active;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.key}`}
                aria-selected={isActive}
                aria-controls={`${baseId}-panel-${t.key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(t.key)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`text-body focus-visible:ring-action relative flex min-h-11 flex-1 items-center justify-center px-3 py-2 font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 ${
                  isActive ? "text-action" : "text-ink-secondary hover:text-ink"
                }`}
              >
                {/* Visible active signal (spec 20) — an indicator bar survives
                    glare where a tint alone washes out. */}
                {isActive ? (
                  <span
                    aria-hidden
                    className="bg-action absolute inset-x-2 bottom-0 h-0.5 rounded-t-full"
                  />
                ) : null}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <div
            key={t.key}
            role="tabpanel"
            id={`${baseId}-panel-${t.key}`}
            aria-labelledby={`${baseId}-tab-${t.key}`}
            hidden={!isActive}
            className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}
          >
            {t.panel}
          </div>
        );
      })}
    </>
  );
}
