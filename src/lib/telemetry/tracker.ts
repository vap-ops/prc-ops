// Spec 244 U1b / ADR 0068 (Tier B) — the DOM/timer/beacon shell around the pure
// core in session.ts. Instantiated ONLY client-side (in TelemetryProvider's
// effect), so browser globals are safe. Best-effort: never blocks the UI, never
// throws into the app, drops events rather than growing unbounded (EventBuffer).
//
// Screen time is derived downstream (U1b usage_daily rollup) from the visible
// intervals these events describe: session_start on foreground, heartbeat every
// 20s while visible, session_end on hide/pagehide.

import {
  EventBuffer,
  makeEvent,
  type FrictionEventType,
  type TelemetryEvent,
  type TelemetryEventType,
} from "./session";

const INGEST_URL = "/api/telemetry";
const HEARTBEAT_MS = 20_000;
const FLUSH_MS = 20_000;
// Cap js_error events per session so an app error loop can't flood the pipe.
const MAX_ERRORS_PER_SESSION = 25;
// Cap the other friction signals (rage_tap/form_abandon/validation_error/
// upload_fail) per session — a repeating signal must not flood the pipe either.
const MAX_FRICTION_PER_SESSION = 50;

export class UsageTracker {
  private readonly buffer = new EventBuffer();
  private readonly sessionId = crypto.randomUUID();
  private heartbeatTimer: number | null = null;
  private flushTimer: number | null = null;
  private started = false;
  private errorCount = 0;
  private frictionCount = 0;

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.emit("session_start");
    this.heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") this.emit("heartbeat");
    }, HEARTBEAT_MS);
    this.flushTimer = window.setInterval(() => void this.flush(), FLUSH_MS);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
  }

  trackRoute(pathname: string): void {
    if (!this.started) return;
    this.emit("route_view", pathname);
  }

  // Spec 244 U2a — an uncaught error on the current screen = a friction signal
  // ("this screen hurts"). Best-effort + capped per session; the message is
  // already extracted + bounded by the caller (errorMessageForTelemetry).
  trackError(message: string): void {
    if (!this.started) return;
    if (this.errorCount >= MAX_ERRORS_PER_SESSION) return;
    this.errorCount++;
    this.emit("js_error", undefined, { message });
  }

  // Spec 244 U2b — a friction signal reported by a feature component through the
  // module-level friction bridge (friction.ts): rage_tap / form_abandon /
  // validation_error / upload_fail. Best-effort + capped per session; no-op until
  // the tracker starts (so pre-consent calls are dropped). The caller supplies only
  // aggregate context (route/kind/type), never content — PDPA-minimized (spec 244 D5).
  trackFriction(type: FrictionEventType, context?: Record<string, unknown>): void {
    if (!this.started) return;
    if (this.frictionCount >= MAX_FRICTION_PER_SESSION) return;
    this.frictionCount++;
    this.emit(type, undefined, context);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.flushBeacon();
  }

  private currentRoute(): string | null {
    return typeof window !== "undefined" ? window.location.pathname : null;
  }

  private emit(type: TelemetryEventType, route?: string, context?: Record<string, unknown>): void {
    this.buffer.add(
      makeEvent(
        this.sessionId,
        type,
        { route: route ?? this.currentRoute(), context: context ?? null },
        new Date().toISOString(),
      ),
    );
    if (this.buffer.shouldFlush()) void this.flush();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      this.emit("session_end");
      this.flushBeacon();
    } else {
      this.emit("session_start");
    }
  };

  private readonly onPageHide = (): void => {
    this.emit("session_end");
    this.flushBeacon();
  };

  private async flush(): Promise<void> {
    const batch = this.buffer.drain();
    if (batch.length === 0) return;
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (!res.ok) this.requeue(batch);
    } catch {
      this.requeue(batch);
    }
  }

  // Sync flush for hide/unload — sendBeacon survives page teardown where fetch
  // may be cancelled. Falls back to keepalive fetch where sendBeacon is absent.
  private flushBeacon(): void {
    const batch = this.buffer.drain();
    if (batch.length === 0) return;
    const body = JSON.stringify({ events: batch });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(INGEST_URL, new Blob([body], { type: "application/json" }));
      if (!ok) this.requeue(batch);
      return;
    }
    void fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => this.requeue(batch));
  }

  private requeue(batch: TelemetryEvent[]): void {
    for (const e of batch) this.buffer.add(e);
  }
}
