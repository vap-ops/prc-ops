"use client";

import { useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { boundaryRetryKey, hasRecentRetry, recordRetry } from "@/lib/errors/boundary-retry";
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
//   Emitted ONCE per mount (ref-guarded: StrictMode dev double-invokes
//   effects, and the friction-map counts must stay comparable with the
//   window.onerror path, which does not double).
// ② F-012 — honest-copy split. A FIRST crash is genuinely retryable
//   (transient state) and keeps ลองใหม่ primary. A crash that RECURRED after
//   the user already pressed retry stops promising retry and names real next
//   steps. Mechanism (verified against next/dist/client/components/
//   error-boundary.js): reset() clears the boundary's error state, which
//   UNMOUNTS this fallback in that commit; if the children throw again the
//   fallback REMOUNTS fresh — so recurrence lives in sessionStorage
//   (boundary-retry.ts: digest-or-name + route key, TTL-expired), recorded
//   BEFORE reset(), and a mount-time read is sufficient AND necessary.
// ③ The recurred variant's exits are HARD <a> navigations on purpose: the
//   stale-bundle crash class (ChunkLoadError — a known live failure mode on
//   this fleet) breaks the client router itself, and the recurred state is
//   precisely "soft recovery already failed once". A full document load is
//   the escape hatch that cannot depend on the broken bundle.

type BoundaryError = Error & { digest?: string };

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: BoundaryError;
  reset: () => void;
}) {
  const key = boundaryRetryKey(error);
  // Mount-time read is correct here: a failed reset REMOUNTS this component
  // (see header ②), so every appearance of the fallback re-reads the store.
  const [recurred] = useState(() => hasRecentRetry(key));
  // Shown so a feedback report can name the incident. A client crash has no
  // Next digest — the error name is a coarse fallback; the telemetry row
  // (message + route + timestamp) is what support correlates on.
  const code = error.digest ?? error.name;

  const emitted = useRef(false);
  useEffect(() => {
    if (emitted.current) return;
    emitted.current = true;
    // route is deliberately NOT duplicated in context — the tracker stamps
    // the current route on every event it emits.
    trackFriction("js_error", {
      where: "error_boundary",
      message: errorMessageForTelemetry(error),
      digest: error.digest ?? null,
      recurred,
    });
  }, [error, recurred]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // On the recurred variant the retry button (the old focus target) no
    // longer exists — land keyboard/screen-reader focus on the heading so
    // the new state is where the user already is.
    if (recurred) headingRef.current?.focus();
  }, [recurred]);

  function onRetry() {
    recordRetry(key);
    reset();
  }

  if (recurred) {
    return (
      <PageShell variant="card">
        <div className="max-w-md space-y-6 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
            {ERROR_BOUNDARY_RECURRED_TITLE}
          </h1>
          <p role="alert" className="text-ink-secondary text-sm">
            {ERROR_BOUNDARY_RECURRED_BODY}
          </p>
          <div className="flex flex-col items-center gap-3 pt-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                header ③: the stale-bundle crash class breaks the client
                router; the escape hatch must be a full document load. */}
            <a
              href="/"
              className="bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {ERROR_BOUNDARY_HOME}
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                same stale-bundle rationale as the home link above. */}
            <a
              href="/feedback"
              className="border-edge-strong text-ink hover:bg-sunk focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md border px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            >
              {ERROR_BOUNDARY_REPORT}
            </a>
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
