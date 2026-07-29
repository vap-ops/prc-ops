"use client";

// Spec 339 U2b — the non-forcing update chip, for APPROVED users.
//
// U1 answered "is THIS device running the current build?" honestly, but only
// inside /settings → เกี่ยวกับ. Measured 2026-07-30: of 15 users active in the
// last 3 days, **14 were running a stale bundle** (one technician 31 releases
// behind), and site admins opened /settings 70 times in 14 days against 810
// visits to /sa. The detection was right; nobody was standing where it rendered.
// So the same comparison moves into the app chrome, where they already are.
//
// U2a auto-reloads the UNAPPROVED cohort, who have no task in flight. This one
// must never do that: an approved user may be mid-capture or mid-form, so the
// chip OFFERS and only reloads on an explicit tap (spec D5, operator 2026-07-16).
//
// Fetch failure renders nothing — never nag on the strength of a failed request.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { clientEnv } from "@/lib/env";
import {
  UPDATE_AVAILABLE_LABEL,
  UPDATE_APPLY_LABEL,
  UPDATE_DISMISS_LABEL,
} from "@/lib/i18n/labels";

/** Vercel appends a short sha (`0.270.0+7f3a1c2`); /api/health never does. */
function baseVersion(v: string): string {
  return v.split("+")[0] ?? v;
}

export interface UpdateDecision {
  /** The build this bundle was compiled from, or null when unset (dev/test). */
  clientVersion: string | null;
  /** What /api/health reports right now, or null when the probe failed. */
  deployedVersion: string | null;
  /** The deployed version the user already dismissed this session, if any. */
  dismissedFor: string | null;
}

/**
 * Pure so the whole decision is testable without a fetch, a timer or a DOM —
 * the same shape U2a's `shouldReload` uses.
 */
export function shouldOfferUpdate({
  clientVersion,
  deployedVersion,
  dismissedFor,
}: UpdateDecision): boolean {
  if (!clientVersion) return false; // unknown build — cannot judge, stay quiet
  if (!deployedVersion) return false; // probe failed / offline — leave them alone
  if (baseVersion(clientVersion) === deployedVersion) return false; // already current
  // Scoped to the version dismissed, NOT a blanket mute: dismissing 0.270.0 must
  // not silence 0.271.0, or one tap ends every future notice for the session.
  if (dismissedFor === deployedVersion) return false;
  return true;
}

const SESSION_KEY = "app-update-dismissed-for";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null; // private mode / storage disabled — treat as never dismissed
  }
}

/**
 * The chip. `probed` is injected in tests; in the app it is discovered by the
 * effect below. Presentational + the two actions, so RTL can drive it directly.
 */
export function UpdateAvailableChip({
  clientVersion = clientEnv.NEXT_PUBLIC_APP_VERSION || null,
  probed,
}: {
  clientVersion?: string | null;
  probed?: string | null;
}) {
  const [deployedVersion, setDeployedVersion] = useState<string | null>(probed ?? null);
  // Lazy initialiser, not an effect: the React Compiler lint rightly rejects a
  // synchronous setState inside an effect. SSR-safe via the `window` guard, and
  // hydration-safe because the first render returns null on BOTH sides anyway
  // (`deployedVersion` is null until the probe resolves).
  const [dismissedFor, setDismissedFor] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readDismissed(),
  );

  // Probe on mount and whenever the app comes back to the foreground — a PWA
  // resumed from background is exactly the case this exists for, and it does not
  // re-mount. `no-store` because a cached probe would report the build the stale
  // bundle was serving.
  useEffect(() => {
    if (probed !== undefined) return; // test-injected; do not fetch
    let alive = true;
    const probe = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const body: unknown = await res.json();
        const version =
          typeof body === "object" && body !== null && "version" in body
            ? String((body as { version: unknown }).version)
            : null;
        if (alive) setDeployedVersion(version);
      } catch {
        // Offline or blocked — leave `deployedVersion` as-is and render nothing.
      }
    };
    void probe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void probe();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [probed]);

  const dismiss = useCallback(() => {
    if (!deployedVersion) return;
    try {
      sessionStorage.setItem(SESSION_KEY, deployedVersion);
    } catch {
      // Storage unavailable — still hide it for this render.
    }
    setDismissedFor(deployedVersion);
  }, [deployedVersion]);

  if (!shouldOfferUpdate({ clientVersion, deployedVersion, dismissedFor })) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4"
    >
      <div className="border-action bg-card shadow-card pointer-events-auto flex max-w-[22rem] items-center gap-2 rounded-full border px-2 py-1.5">
        <span className="text-meta text-ink pl-2 font-medium">{UPDATE_AVAILABLE_LABEL}</span>
        <button
          type="button"
          onClick={() => location.reload()}
          className="bg-action text-on-fill focus-visible:ring-action inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2"
        >
          <RefreshCw aria-hidden className="size-4" />
          {UPDATE_APPLY_LABEL}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={UPDATE_DISMISS_LABEL}
          className="text-ink-muted hover:text-ink focus-visible:ring-action inline-flex size-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
