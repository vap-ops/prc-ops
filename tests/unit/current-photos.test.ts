// Unit test for the current-photos filtering + grouping logic.
//
// The helper is the load-bearing read pattern from ADR 0015: current
// photos for a WP/phase are rows whose `storage_path` is NOT NULL AND
// that no other row's `superseded_by` references (ADR 0009 anti-join).
// Tombstones (storage_path NULL) and superseded photos are excluded.

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { selectCurrentPhotosByPhase, type PhotoLogRow } from "@/lib/photos/current-photos";

function row(partial: Partial<PhotoLogRow> & Pick<PhotoLogRow, "id">): PhotoLogRow {
  return {
    work_package_id: "wp-1",
    phase: "before",
    storage_path: `path/${partial.id}.jpg`,
    superseded_by: null,
    uploaded_by: "user-1",
    created_at: "2026-05-24T00:00:00Z",
    captured_at_client: null,
    ...partial,
  };
}

describe("selectCurrentPhotosByPhase", () => {
  it("returns empty buckets when there are no rows", () => {
    expect(selectCurrentPhotosByPhase([])).toEqual({
      before: [],
      during: [],
      after: [],
    });
  });

  it("groups real photos by phase", () => {
    const rows: PhotoLogRow[] = [
      row({ id: "a", phase: "before" }),
      row({ id: "b", phase: "during" }),
      row({ id: "c", phase: "after" }),
      row({ id: "d", phase: "before" }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.before.map((r) => r.id).sort()).toEqual(["a", "d"]);
    expect(result.during.map((r) => r.id)).toEqual(["b"]);
    expect(result.after.map((r) => r.id)).toEqual(["c"]);
  });

  it("excludes tombstone rows (storage_path NULL)", () => {
    const rows: PhotoLogRow[] = [
      row({ id: "a", phase: "before" }),
      // Tombstone of a — should not appear in the result and should remove a
      row({ id: "t", phase: "before", storage_path: null, superseded_by: "a" }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.before).toEqual([]);
  });

  it("excludes superseded rows via the anti-join", () => {
    // Replacement chain: A -> B -> C. Only C is current.
    const rows: PhotoLogRow[] = [
      row({ id: "A", phase: "after" }),
      row({ id: "B", phase: "after", superseded_by: "A" }),
      row({ id: "C", phase: "after", superseded_by: "B" }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.after.map((r) => r.id)).toEqual(["C"]);
  });

  it("handles the ADR 0015 worked example (A uploaded, B uploaded, A tombstoned)", () => {
    const rows: PhotoLogRow[] = [
      row({ id: "id-A", phase: "during" }),
      row({ id: "id-B", phase: "during" }),
      row({ id: "id-T", phase: "during", storage_path: null, superseded_by: "id-A" }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.during.map((r) => r.id)).toEqual(["id-B"]);
  });
});
