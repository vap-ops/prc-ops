// Writing failing test first.
//
// Spec 352 — the capture-method SSOT. Every value that records which input
// affordance a user tapped (camera shutter / library button / plain picker)
// comes from this one file, and the `metadata` option that stamps it into
// storage.objects.user_metadata is built by one helper. No magic strings.

import { describe, expect, it } from "vitest";
import { CAPTURE_METHODS, captureMethodMetadata } from "@/lib/photos/capture-method";

describe("capture-method SSOT (spec 352)", () => {
  it("enumerates exactly camera, library, picker in order", () => {
    expect(CAPTURE_METHODS).toEqual(["camera", "library", "picker"]);
  });

  it("builds the storage metadata option for a given affordance", () => {
    expect(captureMethodMetadata("camera")).toEqual({ captureMethod: "camera" });
    expect(captureMethodMetadata("library")).toEqual({ captureMethod: "library" });
    expect(captureMethodMetadata("picker")).toEqual({ captureMethod: "picker" });
  });
});
