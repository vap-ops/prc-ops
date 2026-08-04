// UX-audit G1 review catch: a js_error arriving through the friction bridge
// (the error boundary, feature catch blocks) must budget against the
// DEDICATED error cap (25/session), exactly like the window.onerror path —
// NOT the shared friction pool (50/session). Before this, a crash-retry loop
// consumed the friction budget and starved rage_tap / upload_fail /
// form_abandon for the rest of the session, silently skewing the friction map.
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "@/lib/telemetry/tracker";

function startedTracker(): { tracker: UsageTracker; emitted: string[] } {
  const tracker = new UsageTracker("test-version");
  const emitted: string[] = [];
  // Observe the private emit seam — the cap logic sits in front of it.
  vi.spyOn(tracker as unknown as { emit: (type: string) => void }, "emit").mockImplementation(
    function (type: string) {
      emitted.push(type);
    },
  );
  tracker.start();
  return { tracker, emitted };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("js_error budget routing (UX-audit G1)", () => {
  it("js_error via trackFriction consumes the ERROR budget, not the friction pool", () => {
    const { tracker, emitted } = startedTracker();
    for (let i = 0; i < 30; i++) tracker.trackFriction("js_error");
    // capped at the dedicated 25, like trackError
    expect(emitted.filter((t) => t === "js_error")).toHaveLength(25);
    // ...and the friction pool is untouched: a rage_tap still goes through
    tracker.trackFriction("rage_tap");
    expect(emitted.filter((t) => t === "rage_tap")).toHaveLength(1);
  });

  it("the two paths share ONE error budget (bridge + window.onerror)", () => {
    const { tracker, emitted } = startedTracker();
    for (let i = 0; i < 20; i++) tracker.trackError("boom");
    for (let i = 0; i < 20; i++) tracker.trackFriction("js_error");
    expect(emitted.filter((t) => t === "js_error")).toHaveLength(25);
  });

  it("non-error friction keeps its own 50 cap", () => {
    const { tracker, emitted } = startedTracker();
    for (let i = 0; i < 60; i++) tracker.trackFriction("rage_tap");
    expect(emitted.filter((t) => t === "rage_tap")).toHaveLength(50);
  });
});
