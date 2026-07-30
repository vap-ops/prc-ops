// Spec 359 U1 — per-scan feedback for the continuous sweep. The SA is watching
// the LINE, not the screen, so a purely visual tally would just relocate the
// friction it exists to remove: they would have to look down after every worker.
//
// Both channels are best-effort and independently optional. iOS Safari has no
// navigator.vibrate at all, and an AudioContext may be blocked until a user
// gesture — the sweep must degrade to visual-only rather than throw mid-line.

import type { SweepOutcomeKind } from "./sweep";

/** Vibration patterns, in ms. Distinct shapes so they are told apart by feel alone. */
const PATTERN: Record<SweepOutcomeKind, number[]> = {
  added: [40],
  added_first_time: [40],
  added_team_changed: [40, 60, 40],
  already_here: [15],
  other_team: [180],
  unknown_badge: [180],
  failed: [180],
  // Spec 359 U4 — the evening rounds. A write is one pulse like a check-in (the
  // SA is watching the man, not the screen); a benign repeat is the short tick;
  // "this badge has nothing to act on" joins the long attention buzz, because it
  // means someone is standing there un-mustered.
  checked_out: [40],
  ot_opened: [40],
  ot_closed: [40],
  already_out: [15],
  ot_already_open: [15],
  ot_already_closed: [15],
  not_checked_in: [180],
  no_ot: [180],
  // Spec 379 U2 — a retraction is a deliberate two-tap act, so it CONFIRMS
  // rather than warns. Its own shape: two short ticks, told apart by feel from
  // both the single add pulse and the long attention buzz.
  undone: [25, 50, 25],
};

/** Tone frequency in Hz, paired with the pattern above. */
const TONE: Record<SweepOutcomeKind, number> = {
  added: 880,
  added_first_time: 880,
  added_team_changed: 660,
  already_here: 520,
  other_team: 300,
  unknown_badge: 300,
  failed: 300,
  // A check-out is a success, but a LOWER one than a check-in: the two rounds run
  // hours apart and must not be mistaken for each other by ear alone.
  checked_out: 760,
  ot_opened: 990,
  ot_closed: 700,
  already_out: 520,
  ot_already_open: 520,
  ot_already_closed: 520,
  not_checked_in: 300,
  no_ot: 300,
  // Below every success tone, above the error buzz: the write did happen and
  // was taken back — neither a new record nor a failure.
  undone: 420,
};

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function beep(hz: number, ms: number): void {
  const ac = audioContext();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = hz;
  // A bare oscillator at full gain clips audibly; a small fixed gain keeps it a chirp.
  gain.gain.value = 0.08;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + ms / 1000);
}

export function playScanCue(kind: SweepOutcomeKind): void {
  try {
    navigator.vibrate?.(PATTERN[kind]);
  } catch {
    // A blocked or throwing vibrate must never abort the sweep.
  }
  try {
    beep(
      TONE[kind],
      PATTERN[kind].reduce((a, b) => a + b, 0),
    );
  } catch {
    // Same for audio — autoplay policy, no output device, a stub in tests.
  }
}
