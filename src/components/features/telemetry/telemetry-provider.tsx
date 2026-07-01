"use client";

// Spec 244 U1b — mounts the client usage tracker on the SA surfaces. 'use client'
// is justified: it wires browser lifecycle (visibility/heartbeat/route) to the
// tracker and owns the one-time consent notice. Capture starts only after the
// notice is acknowledged (per device); a kill switch (enabled) can disable it.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { UsageTracker } from "@/lib/telemetry/tracker";
import { UsageNotice } from "./usage-notice";

const CONSENT_KEY = "telemetry_notice_ack_v1";

export function TelemetryProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const trackerRef = useRef<UsageTracker | null>(null);
  const [needsNotice, setNeedsNotice] = useState(false);
  const pathname = usePathname();

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
    if (!enabled) return;
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
    return () => stop();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !pathname) return;
    trackerRef.current?.trackRoute(pathname);
  }, [pathname, enabled]);

  function ack() {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // private mode / storage disabled — proceed without persistence
    }
    setNeedsNotice(false);
    start();
  }

  return (
    <>
      {children}
      {needsNotice ? <UsageNotice onAck={ack} /> : null}
    </>
  );
}
