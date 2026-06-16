"use client";

// Registers the network-only service worker (spec 18, PWA
// installability). 'use client' is justified: navigator access in an
// effect. Production-only — a SW on the dev server would fight HMR.
// Renders nothing.

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw-register] registration failed", err);
    });
  }, []);
  return null;
}
