"use client";

// Spec 244 U1b/U1c — mounts the client usage tracker app-wide (from the root
// layout) and owns the one-time consent notice. 'use client' is justified: it wires
// browser lifecycle (visibility/heartbeat/route) to the tracker. U1c: capture is
// gated to INTERNAL app surfaces via isTrackableRoute — it skips the root dispatcher,
// unauthenticated pages (so the notice never shows pre-login), and the external
// client/contractor portals. Capture starts only after the notice is acknowledged
// (per device); a kill switch (enabled) can disable it entirely. Childless: it runs
// via effects + renders only the notice, so it sits as a root-layout sibling.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { UsageTracker } from "@/lib/telemetry/tracker";
import { isTrackableRoute } from "@/lib/telemetry/scope";
import { errorMessageForTelemetry } from "@/lib/telemetry/session";
import { setFrictionSink } from "@/lib/telemetry/friction";
import { RageTapDetector } from "@/lib/telemetry/rage-tap";
import { UsageNotice } from "./usage-notice";

const CONSENT_KEY = "telemetry_notice_ack_v1";

export function TelemetryProvider({ enabled = true }: { enabled?: boolean }) {
  const trackerRef = useRef<UsageTracker | null>(null);
  const [needsNotice, setNeedsNotice] = useState(false);
  const pathname = usePathname();
  const trackable = enabled && isTrackableRoute(pathname ?? "");

  function start() {
    if (trackerRef.current) return;
    const t = new UsageTracker();
    trackerRef.current = t;
    t.start();
    // Register the live tracker so feature components (upload queue, forms) can
    // emit friction app-wide via the module-level bridge (spec 244 U2b).
    setFrictionSink(t);
  }
  function stop() {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setFrictionSink(null);
  }

  useEffect(() => {
    if (!trackable) return;
    let acked = false;
    try {
      acked = localStorage.getItem(CONSENT_KEY) === "1";
    } catch {
      acked = false;
    }
    if (acked) start();
    // localStorage is client-only, so the show-notice decision must be made
    // post-mount (reading it in a lazy initializer would hydration-mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setNeedsNotice(true);

    // Spec 244 U2a: uncaught errors on a trackable screen = js_error friction.
    // These are a no-op until the tracker starts (e.g. before consent is acked),
    // since trackError guards on `started`.
    const onError = (e: ErrorEvent) =>
      trackerRef.current?.trackError(errorMessageForTelemetry(e.error ?? e.message));
    const onRejection = (e: PromiseRejectionEvent) =>
      trackerRef.current?.trackError(errorMessageForTelemetry(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Spec 244 U2b-4: rapid repeated taps on one target = rage_tap friction. Fresh
    // detector per trackable mount; capture-phase so we see the tap early. No-op
    // until the tracker starts (trackFriction guards on `started`).
    const rage = new RageTapDetector();
    const onPointerDown = (e: PointerEvent) => {
      if (rage.tap(e.target, e.timeStamp)) trackerRef.current?.trackFriction("rage_tap");
    };
    window.addEventListener("pointerdown", onPointerDown, true);

    // On leaving a trackable surface (or unmount), drop the listeners + end the
    // session cleanly.
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("pointerdown", onPointerDown, true);
      stop();
    };
  }, [trackable]);

  useEffect(() => {
    if (!trackable || !pathname) return;
    trackerRef.current?.trackRoute(pathname);
  }, [pathname, trackable]);

  function ack() {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // private mode / storage disabled — proceed without persistence
    }
    setNeedsNotice(false);
    start();
  }

  // Gate on `trackable` too: a notice queued on a trackable route must not linger
  // if the user navigates to a non-trackable one (unauth /login, external portals)
  // before acknowledging.
  return needsNotice && trackable ? <UsageNotice onAck={ack} /> : null;
}
