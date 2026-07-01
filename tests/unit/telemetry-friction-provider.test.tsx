import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "@/lib/telemetry/tracker";
import { trackFriction } from "@/lib/telemetry/friction";

// Spec 244 U2b — the root TelemetryProvider registers its active tracker as the
// app-wide friction sink on start (after consent) and clears it on leave/unmount,
// so a feature component's module-level trackFriction() reaches the live tracker
// ONLY while capture is active on a trackable surface.

const nav = vi.hoisted(() => ({ path: "/sa" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { TelemetryProvider } from "@/components/features/telemetry/telemetry-provider";

const CONSENT_KEY = "telemetry_notice_ack_v1";

afterEach(() => {
  cleanup();
  localStorage.clear();
  nav.path = "/sa";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TelemetryProvider friction sink registration", () => {
  it("routes a module-level trackFriction() to the live tracker while active", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1"); // consented → tracker starts + registers
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    render(<TelemetryProvider />);

    trackFriction("upload_fail", { kind: "phase_photo" });
    expect(spy).toHaveBeenCalledWith("upload_fail", { kind: "phase_photo" });
  });

  it("clears the sink on unmount — trackFriction() no longer reaches a tracker", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    const { unmount } = render(<TelemetryProvider />);
    unmount();

    trackFriction("upload_fail", { kind: "phase_photo" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not register on a non-trackable route (no tracker, no sink)", () => {
    vi.useFakeTimers();
    localStorage.setItem(CONSENT_KEY, "1");
    nav.path = "/login";
    const spy = vi.spyOn(UsageTracker.prototype, "trackFriction");
    render(<TelemetryProvider />);

    trackFriction("upload_fail", { kind: "phase_photo" });
    expect(spy).not.toHaveBeenCalled();
  });
});
