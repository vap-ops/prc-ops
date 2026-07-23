"use client";

// Spec 339 U2 — force an unapproved user onto the current build.
//
// 'use client' is load-bearing, same reason as U1's AppVersionCheck: the two
// versions being compared come from opposite sides of the stale-bundle boundary.
//   - NEXT_PUBLIC_APP_VERSION is inlined into the CLIENT bundle at build time
//     (next.config.ts). A PWA resumed from background is still executing its OLD
//     bundle, so this constant is the old build's number — the value that goes
//     stale.
//   - /api/health returns `pkg.version` from the live server process
//     (force-dynamic), so even a stranded client fetching it gets the CURRENT
//     deployed number.
// A mismatch means this device is running code the server has moved past. U1
// tells the user; U2 acts — but ONLY on the pre-approval routes this component is
// mounted on (register/*, the visitor branch of /coming-soon), because a forced
// reload throws away in-flight work and those are the only screens where there is
// none worth keeping. Approved users keep U1's passive chip.
//
// Why not the service worker: it caches only immutable /_next/static hashes, so
// it is not what pins a stale bundle in memory — the resumed in-memory instance
// is (memory ios-pwa-stale-bundle-2026-07). A full document reload is what
// re-fetches the entry HTML and its new bundle references.

import { useEffect } from "react";

import { clientEnv } from "@/lib/env";

// sessionStorage (not local): the guard should last the life of the tab/session
// and reset on a genuine fresh launch, never persist across launches.
const RELOAD_KEY = "app-freshness-reloaded-for";

// sessionStorage access can THROW (private mode, storage disabled, quota). A read
// that throws is treated as "no guard recorded".
function readReloadGuard(): string | null {
  try {
    return window.sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return null;
  }
}

// Persist the guard, reporting whether it actually stuck. This is load-bearing:
// we reload ONLY when the guard was durably written, because a reload whose guard
// did not persist would re-mount, re-read null, and reload again — the exact loop
// the guard exists to prevent. If storage is unavailable, we would rather never
// reload than risk that loop.
function persistReloadGuard(version: string): boolean {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, version);
    return true;
  } catch {
    return false;
  }
}

// Vercel appends a short commit SHA to the client version (`0.173.0+7f3a1c2`);
// /api/health never carries one, so compare the semver part. Mirrors U1.
function baseVersion(v: string): string {
  return v.split("+")[0] ?? v;
}

export interface ReloadDecision {
  /** NEXT_PUBLIC_APP_VERSION off the client bundle; null when unset (dev/test). */
  clientVersion: string | null;
  /** version reported by /api/health; null when the probe failed / offline. */
  deployedVersion: string | null;
  /** the deployed version we last reloaded for (sessionStorage); null if none. */
  alreadyReloadedFor: string | null;
  /** is the user currently in a text field — never interrupt them. */
  isTyping: boolean;
}

// The whole policy, as one pure function so every branch is pinned without
// mocking the DOM or the network.
export function shouldReload({
  clientVersion,
  deployedVersion,
  alreadyReloadedFor,
  isTyping,
}: ReloadDecision): boolean {
  if (!clientVersion) return false; // unknown client build — cannot judge, stay put
  if (!deployedVersion) return false; // probe failed / offline — leave them be
  if (isTyping) return false; // never yank a reload out from under a typist
  if (baseVersion(clientVersion) === deployedVersion) return false; // already current
  if (alreadyReloadedFor === deployedVersion) return false; // already tried this build — don't loop
  return true;
}

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true;
}

async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      data !== null &&
      typeof data === "object" &&
      "version" in data &&
      typeof (data as { version: unknown }).version === "string"
    ) {
      return (data as { version: string }).version;
    }
    return null;
  } catch {
    return null;
  }
}

export function RegisterFreshnessGate() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      const clientVersion = clientEnv.NEXT_PUBLIC_APP_VERSION || null;
      if (!clientVersion) return; // unknown — skip the probe entirely
      const deployedVersion = await fetchDeployedVersion();
      if (cancelled) return;
      const decision = shouldReload({
        clientVersion,
        deployedVersion,
        alreadyReloadedFor: readReloadGuard(),
        isTyping: isTyping(), // re-read AFTER the await — they may have started typing
      });
      if (!decision || deployedVersion === null) return;
      // Set the guard FIRST and reload only if it stuck — an un-guarded reload can
      // loop (see persistReloadGuard).
      if (!persistReloadGuard(deployedVersion)) return;
      window.location.reload();
    }

    void check();

    // Resume-from-background is the primary trigger: the stale in-memory instance
    // never re-mounts, so only a visibility flip signals "the user is back".
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
