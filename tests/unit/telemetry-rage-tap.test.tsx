import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "@/lib/telemetry/tracker";

// Spec 244 U2b-4 — when tracking is active, rapid repeated taps on the same target
// become a rage_tap friction event. We capture the provider's window pointerdown
// listener via an addEventListener spy and invoke it directly with synthetic events
// (target + timeStamp), rather than dispatching real pointer events.

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

const A = document.createElement("button");
const B = document.createElement("button");

afterEach(() => {
  cleanup();
  localStorage.clear();
  nav.path = "/sa";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TelemetryProvider rage_tap capture", () => {
  it("reports rage_tap after enough rapid taps on the same target", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    nav.path = "/sa";
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);
    for (const ts of [0, 100, 200, 300]) handlers.pointerdown?.({ target: A, timeStamp: ts });

    expect(spy).toHaveBeenCalledWith("rage_tap");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not report for a couple of taps (below the threshold)", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);
    for (const ts of [0, 150]) handlers.pointerdown?.({ target: A, timeStamp: ts });

    expect(spy).not.toHaveBeenCalled();
  });

  it("does not report when the taps are spread across different targets", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);
    handlers.pointerdown?.({ target: A, timeStamp: 0 });
    handlers.pointerdown?.({ target: B, timeStamp: 100 });
    handlers.pointerdown?.({ target: A, timeStamp: 200 });
    handlers.pointerdown?.({ target: B, timeStamp: 300 });

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT register tap capture on a non-trackable route", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    nav.path = "/login";
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    const handlers = captureWindowHandlers();

    render(<TelemetryProvider />);

    expect(handlers.pointerdown).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
