"use client";

// Registers the static-asset-caching service worker (specs 18/241/290, PWA
// installability). 'use client' is justified: navigator access in an
// effect. Production-only — a SW on the dev server would fight HMR.
// Renders nothing.
//
// Spec 290: after registration, nudge the active worker to warm the static
// cache from this deploy's precache manifest — once per browser session
// (sessionStorage throttle). The nudge is fire-and-forget; the SW fail-opens.

import { useEffect } from "react";

const WARM_SENT_KEY = "sw-warm-sent";

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw-register] registration failed", err);
    });
    try {
      if (sessionStorage.getItem(WARM_SENT_KEY)) return;
      sessionStorage.setItem(WARM_SENT_KEY, "1");
    } catch {
      // storage unavailable (private mode edge) — still nudge; the SW warm
      // dedupes against its cache, so an extra message is harmless.
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        reg.active?.postMessage({ type: "WARM_STATIC_CACHE" });
      })
      .catch(() => {
        // never surface warm failures — it's an optimization
      });
  }, []);
  return null;
}
