// Spec 257 U1 — pure day-photo selection: current photos (ADR 0009/0015,
// shared photo-evidence.ts predicate) restricted to a requested set of
// Bangkok ISO dates. Feeds getSchedulePhotos before minting.

import { describe, expect, it } from "vitest";
import { selectDayPhotos } from "@/lib/work-packages/day-photo-selector";
import type { ActivityPhotoRow } from "@/lib/work-packages/photo-evidence";

const WP_A = "11111111-1111-4111-8111-111111111111";

let seq = 0;
function row(overrides: Partial<ActivityPhotoRow>): ActivityPhotoRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    work_package_id: WP_A,
    storage_path: `photos/${seq}.jpg`,
    superseded_by: null,
    captured_at_client: null,
    created_at: "2026-06-15T05:00:00.000Z",
    ...overrides,
  };
}

describe("selectDayPhotos", () => {
  it("empty input → empty output", () => {
    expect(selectDayPhotos([], new Set(["2026-06-15"]))).toEqual([]);
  });

  it("keeps only photos on a requested Bangkok date", () => {
    const a = row({ created_at: "2026-06-15T05:00:00.000Z" });
    const b = row({ created_at: "2026-06-16T05:00:00.000Z" });
    const out = selectDayPhotos([a, b], new Set(["2026-06-15"]));
    expect(out.map((r) => r.id)).toEqual([a.id]);
  });

  it("supports multiple requested dates (week view)", () => {
    const a = row({ created_at: "2026-06-15T05:00:00.000Z" });
    const b = row({ created_at: "2026-06-16T05:00:00.000Z" });
    const c = row({ created_at: "2026-06-20T05:00:00.000Z" });
    const out = selectDayPhotos([a, b, c], new Set(["2026-06-15", "2026-06-16"]));
    expect(out.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("excludes tombstones and superseded rows even within the requested dates", () => {
    const original = row({ created_at: "2026-06-15T05:00:00.000Z" });
    const tomb = row({
      storage_path: null,
      superseded_by: original.id,
      created_at: "2026-06-15T06:00:00.000Z",
    });
    const out = selectDayPhotos([original, tomb], new Set(["2026-06-15"]));
    expect(out).toEqual([]);
  });

  it("preserves extra fields on the row (e.g. uploaded_by) — generic over the input type", () => {
    const withUploader = { ...row({ created_at: "2026-06-15T05:00:00.000Z" }), uploaded_by: "u1" };
    const out = selectDayPhotos([withUploader], new Set(["2026-06-15"]));
    expect(out[0]?.uploaded_by).toBe("u1");
  });
});
