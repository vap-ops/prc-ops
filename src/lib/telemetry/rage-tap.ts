// Spec 244 U2b-4 / ADR 0068 (Tier B) — a pure, DOM-free rage-tap detector. Rapid
// repeated taps on the SAME target signal frustration (an unresponsive control, a
// janky screen). The caller feeds it a target identity + a timestamp per tap; the
// detector says when a burst crosses the threshold. Kept pure so the heuristic is
// unit-testable and can be tuned without touching the DOM wiring in the provider.
//
// Conservative by design: the defaults (4 taps within 700ms on one target) never
// fire on a normal double/triple-tap, and it reports true EXACTLY ONCE per burst
// (on the tap that crosses the threshold) so a long angry press emits a single
// event. Thresholds are constructor params so they can be tuned later.

export class RageTapDetector {
  private burst: { target: unknown; count: number; firstTs: number } | null = null;

  constructor(
    private readonly threshold = 4,
    private readonly windowMs = 700,
  ) {}

  tap(target: unknown, ts: number): boolean {
    const b = this.burst;
    if (b !== null && b.target === target && ts - b.firstTs <= this.windowMs) {
      b.count += 1;
      return b.count === this.threshold;
    }
    // A different target, or the window since the first tap has elapsed → new burst.
    this.burst = { target, count: 1, firstTs: ts };
    return false;
  }
}
