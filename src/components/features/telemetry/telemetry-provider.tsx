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
  }
  function stop() {
    trackerRef.current?.stop();
    trackerRef.current = null;
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
    // On leaving a trackable surface (or unmount), end the session cleanly.
    return () => stop();
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
