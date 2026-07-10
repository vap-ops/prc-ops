"use client";

// Spec 292 U4 — the SA current-site switcher: a chip on /sa naming the project the
// scoped tiles/plan point at, opening a sheet to switch (view-override) or pin
// (primary). 'use client': sheet open-state + the three server actions through a
// transition. The /sa home BODY stays AGGREGATE (locked) — this chip only
// communicates + changes which site the SCOPED surfaces use. Renders nothing for an
// SA with <2 visible projects (single/zero-project SAs never needed a switcher).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, MapPin, Pin } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { INLINE_ERROR } from "@/lib/ui/classes";
import {
  CURRENT_SITE_LABEL,
  CURRENT_SITE_AUTO_HINT,
  VIEWING_SITE_LABEL,
  PRIMARY_SITE_LABEL,
  SET_PRIMARY_SITE_LABEL,
  CLEAR_SITE_OVERRIDE_LABEL,
} from "@/lib/i18n/labels";
import type { SaCurrentProjectSource } from "@/lib/sa/current-project";
import {
  setActiveProjectOverride,
  clearActiveProjectOverride,
  pinPrimaryProject,
  type CurrentProjectActionResult,
} from "@/app/sa/current-project-actions";

/** One visible project for the switcher (a projection of the resolver's
 * SaVisibleProjectRow). A lead-only project (hasMembership false) is viewable but
 * NOT pinnable — the pin RPC's membership gate would reject it 42501. */
export type SwitcherProject = {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
  hasMembership: boolean;
};

export function CurrentProjectSwitcher({
  current,
  projects,
}: {
  current: { projectId: string | null; source: SaCurrentProjectSource };
  projects: SwitcherProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // A switcher only earns its space when the SA has a choice to make.
  if (projects.length < 2) return null;

  const currentProject = projects.find((p) => p.id === current.projectId) ?? null;
  // ?project= (query) is a view-only override too — treat it like the cookie state.
  const isOverride = current.source === "override" || current.source === "query";
  const isDerived = current.source === "derived";

  function run(action: () => Promise<CurrentProjectActionResult>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else {
        // Surface the action's Thai error (a rejected pin / expired session) — else
        // the tap silently no-ops and the sheet just sits there.
        setError(r.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk flex w-full items-center gap-2.5 border px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2"
      >
        <Building2 aria-hidden className="text-action size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-ink-muted block text-[0.65rem] font-medium tracking-wide uppercase">
            {CURRENT_SITE_LABEL}
          </span>
          <span className="text-body text-ink block truncate font-semibold">
            {currentProject ? `${currentProject.code} ${currentProject.name}` : "—"}
          </span>
        </span>
        {isDerived ? (
          <span className="text-ink-muted bg-sunk text-meta shrink-0 rounded-full px-2 py-0.5">
            {CURRENT_SITE_AUTO_HINT}
          </span>
        ) : null}
        {isOverride ? (
          <span className="text-action bg-action/10 text-meta shrink-0 rounded-full px-2 py-0.5 font-medium">
            {VIEWING_SITE_LABEL}
          </span>
        ) : null}
        {current.source === "primary" ? (
          <Pin aria-hidden className="text-ink-muted size-4 shrink-0" />
        ) : null}
      </button>

      <BottomSheet open={open} title={CURRENT_SITE_LABEL} onClose={() => setOpen(false)}>
        <ul className="flex flex-col gap-2">
          {projects.map((p) => {
            const isCurrent = p.id === current.projectId;
            return (
              <li key={p.id} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-current={isCurrent ? "true" : undefined}
                  disabled={busy}
                  onClick={() => run(() => setActiveProjectOverride(p.id))}
                  className={`rounded-control focus-visible:ring-action flex min-w-0 flex-1 items-center gap-2 border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 ${
                    isCurrent ? "border-action bg-action/5" : "border-edge bg-card hover:bg-sunk"
                  }`}
                >
                  <MapPin aria-hidden className="text-ink-muted size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-secondary block font-mono text-xs">{p.code}</span>
                    <span className="text-ink block truncate text-sm font-medium">{p.name}</span>
                  </span>
                  {isCurrent ? <Check aria-hidden className="text-action size-4 shrink-0" /> : null}
                </button>
                {p.isPrimary ? (
                  <span className="text-ink-muted inline-flex shrink-0 items-center gap-1 px-2 text-xs font-medium">
                    <Pin aria-hidden className="size-3.5" />
                    {PRIMARY_SITE_LABEL}
                  </span>
                ) : p.hasMembership ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${SET_PRIMARY_SITE_LABEL} ${p.name}`}
                    onClick={() => run(() => pinPrimaryProject(p.id))}
                    className="text-action rounded-control shrink-0 px-2 py-1 text-xs font-medium hover:underline disabled:opacity-50"
                  >
                    {SET_PRIMARY_SITE_LABEL}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {error ? (
          <div role="alert" className={`${INLINE_ERROR} mt-3`}>
            {error}
          </div>
        ) : null}
        {isOverride ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => clearActiveProjectOverride())}
            className="text-ink-secondary hover:bg-sunk rounded-control mt-3 flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {CLEAR_SITE_OVERRIDE_LABEL}
          </button>
        ) : null}
      </BottomSheet>
    </>
  );
}
