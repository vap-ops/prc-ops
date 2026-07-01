// Spec 244 U1b (TDD, RED first) — the pure client-telemetry core: event building
// + the batch buffer. The DOM wiring (visibility / heartbeat / sendBeacon) is the
// thin shell in tracker.ts; the decision logic lives here so it is unit-testable.
import { describe, it, expect } from "vitest";
import { makeEvent, EventBuffer } from "@/lib/telemetry/session";

describe("makeEvent", () => {
  it("builds a well-formed event, defaulting optionals to null", () => {
    const e = makeEvent("sess-1", "session_start", {}, "2026-07-01T10:00:00.000Z");
    expect(e).toEqual({
      session_id: "sess-1",
      event_type: "session_start",
      route: null,
      context: null,
      app_version: null,
      client_ts: "2026-07-01T10:00:00.000Z",
    });
  });

  it("carries route / context / appVersion when supplied", () => {
    const e = makeEvent(
      "s",
      "route_view",
      { route: "/sa", context: { wp_id: "x" }, appVersion: "1.2.3" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(e.route).toBe("/sa");
    expect(e.context).toEqual({ wp_id: "x" });
    expect(e.app_version).toBe("1.2.3");
  });
});

describe("EventBuffer", () => {
  it("accumulates and drains all events, clearing itself", () => {
    const b = new EventBuffer(20);
    b.add(makeEvent("s", "heartbeat", {}, "t1"));
    b.add(makeEvent("s", "heartbeat", {}, "t2"));
    expect(b.size).toBe(2);
    const out = b.drain();
    expect(out).toHaveLength(2);
    expect(b.size).toBe(0);
    expect(b.drain()).toHaveLength(0);
  });

  it("signals shouldFlush only once it reaches the max batch size", () => {
    const b = new EventBuffer(3);
    b.add(makeEvent("s", "heartbeat", {}, "t"));
    b.add(makeEvent("s", "heartbeat", {}, "t"));
    expect(b.shouldFlush()).toBe(false);
    b.add(makeEvent("s", "heartbeat", {}, "t"));
    expect(b.shouldFlush()).toBe(true);
  });

  it("drops the oldest when it would exceed a hard cap (never grows unbounded)", () => {
    const b = new EventBuffer(2, 4); // maxBatch 2, hardCap 4
    for (let i = 0; i < 6; i++) b.add(makeEvent("s", "heartbeat", { context: { i } }, `t${i}`));
    expect(b.size).toBe(4);
    const out = b.drain();
    // oldest two (i=0,1) dropped; keeps the last four
    expect(out.map((e) => (e.context as { i: number }).i)).toEqual([2, 3, 4, 5]);
  });
});
