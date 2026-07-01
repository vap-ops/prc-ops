import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "@/lib/telemetry/tracker";

// Spec 244 U2a — when tracking is active, an uncaught window error (or unhandled
// promise rejection) becomes a js_error friction event. It must NOT register on a
// non-trackable route (unauth / external portals), matching the capture gate.
//
// We capture the provider's window listeners via an addEventListener spy and
// invoke them directly, rather than dispatching real 'error'/'unhandledrejection'
// events — a real dispatch would also trip vitest's own global error handlers.

const nav = vi.hoisted(() => ({ path: "/sa" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { TelemetryProvider } from "@/components/features/telemetry/telemetry-provider";

const CONSENT_KEY = "telemetry_notice_ack_v1";
type Handler = (e: unknown) => void;

function captureWindowHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  vi.spyOn(window, "addEventListener").mockImplementation((type, fn) => {
    handlers[type as string] = fn as Handler;
  });
  return handlers;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  nav.path = "/sa";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TelemetryProvider js_error capture", () => {
  it("reports an uncaught window error as a js_error friction event", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1"); // consented → the tracker starts
    nav.path = "/sa";
    const spy = vi.spyOn(UsageTracker.prototype, "trackError");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);
    handlers.error?.({ error: new Error("boom"), message: "boom" });

    expect(spy).toHaveBeenCalledWith("Error: boom");
  });

  it("reports an unhandled promise rejection", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    nav.path = "/sa";
    const spy = vi.spyOn(UsageTracker.prototype, "trackError");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);
    handlers.unhandledrejection?.({ reason: new TypeError("nope") });

    expect(spy).toHaveBeenCalledWith("TypeError: nope");
  });

  it("does NOT register error capture on a non-trackable route", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    nav.path = "/login";
    const spy = vi.spyOn(UsageTracker.prototype, "trackError");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);

    expect(handlers.error).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
