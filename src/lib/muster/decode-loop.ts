// Spec 359 follow-up — the muster camera's decode loop, lifted out of
// muster-camera.tsx.
//
// WHY IT MOVED. The loop used to return without rescheduling on a successful
// decode, so the camera decoded exactly ONE badge per mount and could only be
// re-armed by closing and reopening the sheet. Everything spec 359 built for a
// continuous line — the running tally, the 3s per-badge cooldown in sweep.ts,
// the sheet deliberately not closing on a scan — was unreachable, and no test
// could see it: getUserMedia / BarcodeDetector / <video> do not exist in jsdom,
// and the cockpit tests mock MusterCamera as buttons that stay mounted forever.
// The control flow now lives here, behind injected dependencies, so the part
// that was wrong is the part that is tested.
//
// Client-safe by construction: no React, no I/O, no server-only import (a
// server-only value import reaching the "use client" cockpit typechecks green
// and fails `next build` — the #742 lesson).

export interface DecodeTickDeps {
  /** Decode the current frame. Resolves to the payload, or null for no code. */
  decode: () => Promise<string | null>;
  /** Fired once per decoded payload. Dedupe belongs to the caller — the cockpit
   *  holds a per-badge cooldown in a ref (sweep.ts), which is what makes a badge
   *  sitting in frame harmless under a continuous loop. */
  onDetected: (value: string) => void;
  /** True once the camera has been torn down. Checked before the decode AND
   *  after it: a decode in flight when the sheet closes must not fire a stale
   *  scan (fresh-eyes U3b). */
  isStopped: () => boolean;
  /** Queue the next frame (requestAnimationFrame in the component). */
  schedule: (tick: () => void) => void;
  now: () => number;
  /** Minimum gap between decodes. 0 = decode every frame (the native
   *  BarcodeDetector path, which is cheap enough); the jsQR fallback runs
   *  synchronously on the main thread and pays a real cost per call. */
  throttleMs: number;
  /** Keep scanning after a hit. The muster sweep wants a whole lineup in one
   *  camera-open; the equipment scan resolves one sticker and unmounts, so it
   *  passes false and the loop stops itself rather than racing the unmount. */
  continuous: boolean;
}

export function createDecodeTick(deps: DecodeTickDeps): () => Promise<void> {
  const { decode, onDetected, isStopped, schedule, now, throttleMs, continuous } = deps;
  // -Infinity, not 0: the first frame must always decode. In a browser
  // performance.now() is already well past 0 at mount so 0 happened to work,
  // but that is the clock's accident, not the loop's intent.
  let lastDecode = Number.NEGATIVE_INFINITY;

  const tick = async (): Promise<void> => {
    if (isStopped()) return;
    if (now() - lastDecode >= throttleMs) {
      try {
        const value = await decode();
        if (isStopped()) return; // closed mid-decode → don't fire a stale scan
        if (value) {
          onDetected(value);
          if (!continuous) return;
        }
      } catch {
        // transient decode error — keep scanning
      } finally {
        // Stamped AFTER the decode: measuring from the start would let a decode
        // that itself outlasts the window re-run back-to-back with no idle gap,
        // freezing older iPhones (#745).
        lastDecode = now();
      }
    }
    schedule(tick);
  };

  return tick;
}
