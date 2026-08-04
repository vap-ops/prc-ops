"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { trackFriction } from "@/lib/telemetry/friction";
import { errorMessageForTelemetry } from "@/lib/telemetry/session";
import {
  ERROR_BOUNDARY_BODY,
  ERROR_BOUNDARY_CODE_PREFIX,
  ERROR_BOUNDARY_HOME,
  ERROR_BOUNDARY_RECURRED_BODY,
  ERROR_BOUNDARY_RECURRED_TITLE,
  ERROR_BOUNDARY_REPORT,
  ERROR_BOUNDARY_RETRY,
  ERROR_BOUNDARY_TITLE,
} from "@/lib/i18n/labels";

// Localized error boundary — Next.js requires error boundaries to be
// Client Components; that requirement is the 'use client' justification
// (spec 14 item D). Without this file, unhandled render errors fall
// through to Next.js's built-in English page.
//
// UX-audit gap G1 (2026-08): two duties beyond rendering.
// ① F-027 — React swallows boundary-caught throws, so window.onerror (the
//   telemetry provider's listener) structurally never sees a render crash;
//   the boundary itself emits the js_error friction event, or crashes stay
//   invisible in interaction_events and their blast radius unmeasurable.
// ② F-012 — honest-copy split. A FIRST crash is genuinely retryable
//   (transient state) and keeps ลองใหม่ primary. A crash that RECURRED after
//   the user already pressed retry stops promising retry and names real next
//   steps (home — a full <a> navigation, not router state inside a broken
//   tree — and a feedback report carrying the digest). Recurrence is tracked
//   in sessionStorage keyed by error.digest; per the spec-339 lesson the
//   attempt is recorded BEFORE reset() and a throwing sessionStorage must
//   never block the reset itself.

const RETRY_KEY_PREFIX = "err-retry:";

type BoundaryError = Error & { digest?: string };

function retryKey(error: BoundaryError): string {
  // digest is stable per crash site; a digest-less error falls back to its
  // name — coarser, but a coarse recurrence key only ever DELAYS the honest
  // variant by grouping distinct errors, never shows it spuriously for the
  // same repeated one.
  return `${RETRY_KEY_PREFIX}${error.digest ?? error.name}`;
}

function readAttempts(key: string): number {
  try {
    return Number(sessionStorage.getItem(key) ?? "0") || 0;
  } catch {
    return 0;
  }
}

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: BoundaryError;
  reset: () => void;
}) {
  const key = retryKey(error);
  // Recurrence is LIVE STATE seeded from sessionStorage, not a one-shot read:
  // when reset()'s re-render attempt throws again BEFORE commit, React can
  // restore this same fallback instance without remounting it — a mount-time
  // read would stay false forever and the honest variant would never appear.
  // setAttempts covers the same-instance path; the sessionStorage seed covers
  // the remount/next-navigation path. Both must exist.
  const [attempts, setAttempts] = useState(() => readAttempts(key));
  const recurred = attempts > 0;
  const code = error.digest ?? error.name;

  useEffect(() => {
    trackFriction("js_error", {
      where: "error_boundary",
      message: errorMessageForTelemetry(error),
      digest: error.digest ?? null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      recurred,
    });
  }, [error, recurred]);

  function onRetry() {
    try {
      sessionStorage.setItem(key, String(readAttempts(key) + 1));
    } catch {
      // A failed write only means a REMOUNTED boundary cannot know a retry
      // happened — the in-instance state below still records it; never block
      // the reset.
    }
    setAttempts((a) => a + 1);
    reset();
  }

  if (recurred) {
    return (
      <PageShell variant="card">
        <div className="max-w-md space-y-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{ERROR_BOUNDARY_RECURRED_TITLE}</h1>
          <p role="alert" className="text-ink-secondary text-sm">
            {ERROR_BOUNDARY_RECURRED_BODY}
          </p>
          <div className="flex flex-col items-center gap-3 pt-2">
            {/* Link, not a bare <a> (house lint): the boundary itself renders
                fine, so client navigation works — routing away discards the
                crashed segment. The crashed ROUTE stays crashed; home is a
                different segment. */}
            <Link
              href="/"
              className="bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {ERROR_BOUNDARY_HOME}
            </Link>
            <Link
              href="/feedback"
              className="border-edge-strong text-ink hover:bg-sunk focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md border px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            >
              {ERROR_BOUNDARY_REPORT}
            </Link>
          </div>
          <p className="text-ink-secondary text-xs">
            {ERROR_BOUNDARY_CODE_PREFIX}: {code}
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="card">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{ERROR_BOUNDARY_TITLE}</h1>
        <p className="text-ink-secondary text-sm">{ERROR_BOUNDARY_BODY}</p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onRetry}
            className="bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {ERROR_BOUNDARY_RETRY}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
