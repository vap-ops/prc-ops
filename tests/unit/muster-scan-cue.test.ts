// Writing failing test first.
//
// Spec 359 U1 — the continuous sweep's non-visual feedback. The SA is watching
// the LINE, not the screen, so the cue is what tells them a badge landed. Both
// channels are optional at runtime (iOS Safari has no navigator.vibrate; an
// AudioContext may be blocked until a user gesture) — the sweep must degrade to
// visual-only rather than throw mid-line, so every path here is guarded.

import { afterEach, describe, expect, it, vi } from "vitest";
import { playScanCue } from "@/lib/muster/scan-cue";

afterEach(() => {
  Reflect.deleteProperty(navigator, "vibrate");
});

function stubVibrate(impl: () => void = () => {}) {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true });
  return fn;
}

describe("playScanCue", () => {
  it("does not throw when neither AudioContext nor vibrate exists", () => {
    expect(() => playScanCue("added")).not.toThrow();
  });

  it("vibrates a short pulse for an added worker", () => {
    const vibrate = stubVibrate();
    playScanCue("added");
    expect(vibrate).toHaveBeenCalledWith([40]);
  });

  it("gives a first-time add the same pulse as a plain add", () => {
    const vibrate = stubVibrate();
    playScanCue("added_first_time");
    expect(vibrate).toHaveBeenCalledWith([40]);
  });

  it("vibrates a distinct double pulse for a team change", () => {
    const vibrate = stubVibrate();
    playScanCue("added_team_changed");
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40]);
  });

  it("vibrates a long pulse for a refused scan", () => {
    const vibrate = stubVibrate();
    playScanCue("other_team");
    expect(vibrate).toHaveBeenCalledWith([180]);
  });

  it("distinguishes an already-here soft cue from a plain add", () => {
    const vibrate = stubVibrate();
    playScanCue("already_here");
    expect(vibrate).not.toHaveBeenCalledWith([40]);
  });

  it("survives a vibrate implementation that throws", () => {
    stubVibrate(() => {
      throw new Error("blocked");
    });
    expect(() => playScanCue("added")).not.toThrow();
  });

  it("covers every outcome kind — no kind falls through undefined", () => {
    const vibrate = stubVibrate();
    for (const kind of [
      "added",
      "added_team_changed",
      "added_first_time",
      "already_here",
      "other_team",
      "unknown_badge",
      "failed",
    ] as const) {
      vibrate.mockClear();
      playScanCue(kind);
      expect(vibrate, `no pattern for ${kind}`).toHaveBeenCalledWith(expect.any(Array));
    }
  });
});
