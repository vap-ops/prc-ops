import { afterEach, describe, expect, it } from "vitest";
import { setFrictionSink, trackFriction, type FrictionSink } from "@/lib/telemetry/friction";

// Spec 244 U2b — the module-level "emit friction" bridge. Feature components call
// trackFriction() from anywhere (the offline upload queue, form widgets); the root
// TelemetryProvider registers its active tracker as the sink. Every call no-ops
// when no tracker is active (before consent, non-trackable routes, external
// portals). Pure + DOM-free so this decision logic is unit-testable.

afterEach(() => setFrictionSink(null));

function fakeSink(): FrictionSink & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    trackFriction(type, context) {
      calls.push([type, context]);
    },
  };
}

describe("trackFriction / setFrictionSink", () => {
  it("no-ops (never throws) when no sink is registered", () => {
    expect(() => trackFriction("upload_fail", { kind: "phase_photo" })).not.toThrow();
  });

  it("forwards type and context to the registered sink", () => {
    const sink = fakeSink();
    setFrictionSink(sink);
    trackFriction("upload_fail", { kind: "phase_photo" });
    expect(sink.calls).toEqual([["upload_fail", { kind: "phase_photo" }]]);
  });

  it("forwards with no context", () => {
    const sink = fakeSink();
    setFrictionSink(sink);
    trackFriction("rage_tap");
    expect(sink.calls).toEqual([["rage_tap", undefined]]);
  });

  it("stops forwarding once the sink is cleared (tracker stopped / left surface)", () => {
    const sink = fakeSink();
    setFrictionSink(sink);
    setFrictionSink(null);
    trackFriction("form_abandon");
    expect(sink.calls).toEqual([]);
  });

  it("last writer wins — a newly-registered sink replaces the old one", () => {
    const a = fakeSink();
    const b = fakeSink();
    setFrictionSink(a);
    setFrictionSink(b);
    trackFriction("validation_error");
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([["validation_error", undefined]]);
  });
});
