// Spec 244 U2b / ADR 0068 (Tier B) — a module-level "emit friction" bridge so
// feature components anywhere (the offline upload queue, form widgets) can report a
// friction signal WITHOUT threading the tracker through props/React context. The
// root TelemetryProvider registers its active tracker as the sink on start (after
// consent, on a trackable surface) and clears it on stop/leave. Every call no-ops
// when no tracker is active — mirroring the js_error path: gated, best-effort,
// PDPA-minimized (aggregate dimensions only, never keystrokes/content). Pure +
// DOM-free so it is unit-testable.

import type { FrictionEventType } from "./session";

export interface FrictionSink {
  trackFriction(type: FrictionEventType, context?: Record<string, unknown>): void;
}

let sink: FrictionSink | null = null;

// Called by TelemetryProvider only: register the active tracker (start) or clear it
// (stop). Last writer wins; passing null disables friction emission.
export function setFrictionSink(next: FrictionSink | null): void {
  sink = next;
}

// The app-wide entry point for feature components. No-ops when no tracker is active
// (before consent, non-trackable routes, external portals). Best-effort — telemetry
// must never break a feature.
export function trackFriction(type: FrictionEventType, context?: Record<string, unknown>): void {
  sink?.trackFriction(type, context);
}
