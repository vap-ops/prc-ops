import { describe, expect, it, vi } from "vitest";
import { createDecodeTick } from "@/lib/muster/decode-loop";

// The muster camera's decode loop, lifted out of muster-camera.tsx so it can be
// tested at all. getUserMedia / BarcodeDetector / <video> do not exist in jsdom,
// so the loop's CONTROL FLOW — the part that was wrong in production for six
// days — had zero coverage while every cockpit "multi-scan" test passed against
// a MusterCamera mock that stays mounted forever.
//
// The bug these cases exist for: on a successful decode the tick returned
// WITHOUT rescheduling, so the camera decoded exactly one badge per mount. The
// sheet, the sweep tally and the 3s per-badge cooldown were all built for a
// continuous line and could never run.

type Harness = {
  decode: ReturnType<typeof vi.fn>;
  onDetected: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>;
  clock: { t: number };
  stopped: { value: boolean };
};

function harness(
  opts: {
    continuous?: boolean;
    throttleMs?: number;
    decode?: () => Promise<string | null>;
  } = {},
) {
  const clock = { t: 0 };
  const stopped = { value: false };
  const decode = vi.fn(opts.decode ?? (async () => null));
  const onDetected = vi.fn();
  const schedule = vi.fn();
  const tick = createDecodeTick({
    decode,
    onDetected,
    isStopped: () => stopped.value,
    schedule,
    now: () => clock.t,
    throttleMs: opts.throttleMs ?? 0,
    continuous: opts.continuous ?? false,
  });
  const h: Harness = { decode, onDetected, schedule, clock, stopped };
  return { tick, ...h };
}

describe("createDecodeTick", () => {
  it("keeps scanning after a hit when continuous — the whole point of the sweep", async () => {
    const { tick, onDetected, schedule } = harness({
      continuous: true,
      decode: async () => "worker-1",
    });

    await tick();

    expect(onDetected).toHaveBeenCalledWith("worker-1");
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("stops after a hit when not continuous — the equipment scan resolves and unmounts", async () => {
    const { tick, onDetected, schedule } = harness({
      continuous: false,
      decode: async () => "item-1",
    });

    await tick();

    expect(onDetected).toHaveBeenCalledWith("item-1");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reschedules when the frame holds no code, in both modes", async () => {
    for (const continuous of [true, false]) {
      const { tick, onDetected, schedule } = harness({ continuous });

      await tick();

      expect(onDetected).not.toHaveBeenCalled();
      expect(schedule).toHaveBeenCalledTimes(1);
    }
  });

  it("does nothing once stopped — no decode, no reschedule", async () => {
    const { tick, decode, schedule, stopped } = harness({ continuous: true });
    stopped.value = true;

    await tick();

    expect(decode).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("drops a decode that landed after close — no stale scan, no reschedule", async () => {
    const stopMidDecode = { fn: () => {} };
    const { tick, onDetected, schedule, stopped } = harness({
      continuous: true,
      decode: async () => {
        stopMidDecode.fn();
        return "worker-1";
      },
    });
    stopMidDecode.fn = () => {
      stopped.value = true;
    };

    await tick();

    expect(onDetected).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("skips the decode inside the throttle window but still reschedules", async () => {
    const { tick, decode, schedule, clock } = harness({ continuous: true, throttleMs: 180 });

    await tick();
    expect(decode).toHaveBeenCalledTimes(1);

    clock.t = 100;
    await tick();

    expect(decode).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("stamps the throttle AFTER the decode, so a slow decode cannot re-run back-to-back", async () => {
    // #745: measuring from the START of the decode lets a decode that itself
    // takes longer than the window re-run with no idle gap, freezing old iPhones.
    const clock = { t: 0 };
    const decode = vi.fn(async () => {
      clock.t += 300; // the decode itself outlasts the 180ms window
      return null;
    });
    const schedule = vi.fn();
    const tick = createDecodeTick({
      decode,
      onDetected: vi.fn(),
      isStopped: () => false,
      schedule,
      now: () => clock.t,
      throttleMs: 180,
      continuous: true,
    });

    await tick();
    await tick();

    expect(decode).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("survives a transient decode error and keeps scanning", async () => {
    const { tick, onDetected, schedule } = harness({
      continuous: true,
      decode: async () => {
        throw new Error("transient");
      },
    });

    await expect(tick()).resolves.toBeUndefined();
    expect(onDetected).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("stamps the throttle even when the decode threw", async () => {
    const { tick, decode, clock } = harness({
      continuous: true,
      throttleMs: 180,
      decode: async () => {
        throw new Error("transient");
      },
    });

    await tick();
    clock.t = 100;
    await tick();

    expect(decode).toHaveBeenCalledTimes(1);
  });
});
