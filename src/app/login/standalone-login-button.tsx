"use client";

// Spec 43 / ADR 0041 — the installed PWA's login control; spec 44
// hardening for iOS process death.
//
// 'use client' justification: this is handoff orchestration — POST to
// /auth/handoff/start, window.open to LINE, then a poll loop against
// /auth/handoff/poll until the session lands in this context's cookie
// jar. None of that is expressible server-side; the browser flow keeps
// its plain server-rendered anchor (ADR 0012) in login-button.tsx.
//
// The device_code lives in localStorage with an expiry stamp (spec 44):
// iOS routinely KILLS the backgrounded PWA while the user is off in
// LINE/Safari, and sessionStorage does not survive that — the relaunch
// (at any page rendering LoginButton) resumes the poll from
// localStorage instead. LINE opens via SAME-WINDOW navigation (spec
// 45): standalone PWAs have no tab model, so window.open swaps the
// view to a dead about:blank — never use it here.
//
// Polling runs only while the page is visible, plus an immediate check
// on visibilitychange/focus — the common path is "user returns to the
// app, first poll wins".

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { BANNER_ERROR } from "@/lib/ui/classes";

const CODE_STORAGE_KEY = "line_handoff_device_code";
const EXPIRES_STORAGE_KEY = "line_handoff_expires_at";
// Matches the server-side login_handoffs TTL.
const HANDOFF_TTL_MS = 600_000;
const POLL_INTERVAL_MS = 2500;
// TTL is 600 s server-side; stop a little after it can no longer succeed.
const MAX_POLLS = 260;

type Phase = "idle" | "waiting" | "error";

// Minimal external store over localStorage: mutations notify
// subscribers so a resumed waiting state can leave via cancel/fail even
// when no React state changes (the snapshot is the only thing that
// changed).
const storeListeners = new Set<() => void>();

function subscribeToStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function emitStoreChange(): void {
  for (const listener of storeListeners) listener();
}

// Read-only in render (useSyncExternalStore snapshot): a stale or
// malformed stamp just reads as "nothing stored" — clearing happens in
// event handlers, never here.
function readStoredCode(): string | null {
  try {
    const code = localStorage.getItem(CODE_STORAGE_KEY);
    const expiresAt = Number(localStorage.getItem(EXPIRES_STORAGE_KEY));
    if (!code || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return code;
  } catch {
    return null;
  }
}

function storeCode(code: string): void {
  try {
    localStorage.setItem(CODE_STORAGE_KEY, code);
    localStorage.setItem(EXPIRES_STORAGE_KEY, String(Date.now() + HANDOFF_TTL_MS));
  } catch {
    // private-mode storage failures must never break login
  }
  emitStoreChange();
}

function clearStoredCode(): void {
  try {
    localStorage.removeItem(CODE_STORAGE_KEY);
    localStorage.removeItem(EXPIRES_STORAGE_KEY);
  } catch {
    // see storeCode
  }
  emitStoreChange();
}

export function StandaloneLoginButton({
  className,
  navigate,
}: {
  className: string;
  /** Injectable for tests — window.location.assign is unmockable in jsdom. */
  navigate?: (url: string) => void;
}) {
  const [explicitPhase, setPhase] = useState<Phase>("idle");
  const [explicitCode, setDeviceCode] = useState<string | null>(null);

  // Resume a flow that iOS's PWA kill interrupted. useSyncExternalStore
  // keeps this hydration-safe (server snapshot null, client re-reads
  // after hydration) without a setState-in-effect; cancel/fail clear
  // the storage and re-render, so the snapshot follows.
  const storedCode = useSyncExternalStore(subscribeToStore, readStoredCode, () => null);
  const deviceCode = explicitCode ?? storedCode;
  const phase: Phase = explicitPhase === "idle" && storedCode ? "waiting" : explicitPhase;

  const go = useCallback(
    (url: string) => {
      if (navigate) navigate(url);
      else window.location.assign(url);
    },
    [navigate],
  );

  useEffect(() => {
    if (phase !== "waiting" || !deviceCode) return;
    let cancelled = false;
    let inFlight = false;
    let polls = 0;

    function fail() {
      cancelled = true;
      clearStoredCode();
      setDeviceCode(null);
      setPhase("error");
    }

    async function poll() {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== "visible") return;
      if (polls >= MAX_POLLS) {
        fail();
        return;
      }
      polls += 1;
      inFlight = true;
      try {
        const response = await fetch("/auth/handoff/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
        });
        const json = (await response.json()) as { status?: string; redirect?: string };
        if (cancelled) return;
        if (json.status === "ok" && typeof json.redirect === "string") {
          cancelled = true;
          clearStoredCode();
          go(json.redirect);
        } else if (json.status === "expired") {
          fail();
        }
        // "pending" → keep polling.
      } catch {
        // Transient network failure — keep polling.
      } finally {
        inFlight = false;
      }
    }

    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [phase, deviceCode, go]);

  // Spec 45: SAME-WINDOW navigation, never window.open — standalone
  // PWAs have no tab model; iOS swaps the visible view to about:blank
  // (a dead white screen). Leaving this window is safe because the
  // stored code resumes the poll when the PWA returns or relaunches.
  async function start() {
    try {
      const response = await fetch("/auth/handoff/start", { method: "POST" });
      if (!response.ok) throw new Error(`start failed: ${response.status}`);
      const json = (await response.json()) as { device_code: string; authorize_url: string };
      storeCode(json.device_code);
      setDeviceCode(json.device_code);
      setPhase("waiting");
      go(json.authorize_url);
    } catch {
      setPhase("error");
    }
  }

  function cancel() {
    clearStoredCode();
    setDeviceCode(null);
    setPhase("idle");
  }

  if (phase === "waiting") {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm text-zinc-600">
          เปิดแอป LINE เพื่อยืนยันตัวตน แล้วกลับมาที่หน้านี้ — ระบบจะเข้าสู่ระบบให้อัตโนมัติ
        </p>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          ยกเลิก
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {phase === "error" && (
        <p className={BANNER_ERROR}>หมดเวลาหรือเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>
      )}
      <button type="button" onClick={() => void start()} className={className}>
        {phase === "error" ? "ลองอีกครั้ง" : "เข้าสู่ระบบด้วย LINE"}
      </button>
    </div>
  );
}
