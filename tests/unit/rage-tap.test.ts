import { describe, expect, it } from "vitest";
import { RageTapDetector } from "@/lib/telemetry/rage-tap";

// Spec 244 U2b-4 — rapid repeated taps on the SAME target = frustration (an
// unresponsive control, a janky screen). The detector is pure (target identity +
// timestamp injected) so the heuristic is unit-testable and DOM-free. Conservative
// defaults (4 taps within 700ms) so a double/triple-tap never fires; it reports true
// exactly once per burst.

describe("RageTapDetector (spec 244 U2b-4)", () => {
  const A = { id: "a" };
  const B = { id: "b" };

  it("fires once on the Nth tap on one target within the window (default 4/700ms)", () => {
    const d = new RageTapDetector();
    expect(d.tap(A, 0)).toBe(false);
    expect(d.tap(A, 100)).toBe(false);
    expect(d.tap(A, 200)).toBe(false);
    expect(d.tap(A, 300)).toBe(true); // 4th within 700ms
  });

  it("does not re-fire for further taps in the same burst", () => {
    const d = new RageTapDetector();
    [0, 100, 200, 300].forEach((t) => d.tap(A, t));
    expect(d.tap(A, 400)).toBe(false);
    expect(d.tap(A, 500)).toBe(false);
  });

  it("does not fire for a double/triple tap (below threshold)", () => {
    const d = new RageTapDetector();
    expect(d.tap(A, 0)).toBe(false);
    expect(d.tap(A, 120)).toBe(false);
    expect(d.tap(A, 240)).toBe(false);
  });

  it("resets the burst when a different target is tapped", () => {
    const d = new RageTapDetector();
    d.tap(A, 0);
    d.tap(A, 100);
    d.tap(A, 200);
    expect(d.tap(B, 300)).toBe(false); // different target → count restarts
    expect(d.tap(B, 350)).toBe(false);
    expect(d.tap(B, 400)).toBe(false);
    expect(d.tap(B, 450)).toBe(true);
  });

  it("starts a new burst when a tap falls outside the window", () => {
    const d = new RageTapDetector();
    d.tap(A, 0);
    d.tap(A, 100);
    d.tap(A, 200);
    expect(d.tap(A, 900)).toBe(false); // 900 - 0 > 700 → new burst
    expect(d.tap(A, 1000)).toBe(false);
    expect(d.tap(A, 1100)).toBe(false);
    expect(d.tap(A, 1200)).toBe(true); // 4th of the new burst
  });

  it("honors custom threshold and window", () => {
    const d = new RageTapDetector(3, 500);
    expect(d.tap(A, 0)).toBe(false);
    expect(d.tap(A, 200)).toBe(false);
    expect(d.tap(A, 400)).toBe(true);
  });
});
