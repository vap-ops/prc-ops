// Writing failing test first.
//
// friction.ts promises "best-effort — telemetry must never break a feature", but
// the call was a bare `sink?.trackFriction(...)`: a throwing sink propagates into
// whatever feature emitted the signal. That matters now that emissions sit on
// failure paths INSIDE the work — `uploadConditionPhotos` emits before returning,
// and its caller (return-sheet) has no try/catch, so a throw would reject the
// upload and leave the sheet stuck busy with no error. Latent today (the only sink
// is the tracker), which is exactly when it is cheap to close.

import { afterEach, describe, expect, it, vi } from "vitest";

import { setFrictionSink, trackFriction } from "@/lib/telemetry/friction";

afterEach(() => setFrictionSink(null));

describe("trackFriction — a broken sink never reaches the feature", () => {
  it("swallows a throwing sink", () => {
    setFrictionSink({
      trackFriction: () => {
        throw new Error("tracker exploded");
      },
    });

    expect(() => trackFriction("upload_fail", { kind: "catalog_image" })).not.toThrow();
  });

  it("still delivers to a healthy sink", () => {
    const spy = vi.fn();
    setFrictionSink({ trackFriction: spy });

    trackFriction("upload_fail", { kind: "catalog_image", stage: "storage" });

    expect(spy).toHaveBeenCalledWith("upload_fail", {
      kind: "catalog_image",
      stage: "storage",
    });
  });

  it("no-ops with no sink registered", () => {
    setFrictionSink(null);
    expect(() => trackFriction("upload_fail")).not.toThrow();
  });
});
