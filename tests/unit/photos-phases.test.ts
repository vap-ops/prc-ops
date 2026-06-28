// Spec 65 §A/§C — shared phase display list + latest-timestamp helper
// (previously duplicated verbatim between the SA and PM WP detail pages),
// and the derived accept-attribute MIME list for photo file inputs.
import { describe, expect, it } from "vitest";

import { PHASES, latestCreatedAt } from "@/lib/photos/phases";
import { PHOTO_ACCEPT_MIME } from "@/lib/photos/path";
import { PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";

describe("PHASES", () => {
  it("keeps the before/during/after order + the after_fix addendum, canonical labels", () => {
    // Feedback 0fa23307: after_fix (หลังแก้ไข) is a 4th display bucket.
    expect(PHASES.map((p) => p.phase)).toEqual(["before", "during", "after", "after_fix"]);
    expect(PHASES.map((p) => p.label)).toEqual([
      PHOTO_PHASE_LABEL.before,
      PHOTO_PHASE_LABEL.during,
      PHOTO_PHASE_LABEL.after,
      PHOTO_PHASE_LABEL.after_fix,
    ]);
  });
});

describe("latestCreatedAt", () => {
  it("returns null for an empty list", () => {
    expect(latestCreatedAt([])).toBeNull();
  });

  it("returns the max created_at on unsorted input (string compare, ISO)", () => {
    const photos = [
      { created_at: "2026-06-12T10:00:00Z" },
      { created_at: "2026-06-13T08:30:00Z" },
      { created_at: "2026-06-11T23:59:59Z" },
    ];
    expect(latestCreatedAt(photos)).toBe("2026-06-13T08:30:00Z");
  });
});

describe("PHOTO_ACCEPT_MIME", () => {
  it("pins the exact accept list the uploaders previously hand-wrote", () => {
    expect(PHOTO_ACCEPT_MIME).toBe("image/jpeg,image/png,image/webp,image/heic");
  });
});
