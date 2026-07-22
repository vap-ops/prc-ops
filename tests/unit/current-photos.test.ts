// Unit test for the current-photos filtering + grouping logic.
//
// The helper is the load-bearing read pattern from ADR 0015: current
// photos for a WP/phase are rows whose `storage_path` is NOT NULL AND
// that no other row's `superseded_by` references (ADR 0009 anti-join).
// Tombstones (storage_path NULL) and superseded photos are excluded.

import { describe, it, expect } from "vitest";

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
    rework_round: 0,
    answers_photo_id: null,
    ...partial,
  };
}

describe("selectCurrentPhotosByPhase", () => {
  it("returns empty buckets when there are no rows", () => {
    expect(selectCurrentPhotosByPhase([])).toEqual({
      before: [],
      during: [],
      after: [],
      after_fix: [],
      defect: [],
    });
  });

  // Spec 248 U1 — deploy-window tolerance: a phase value this build does not
  // know (the enum grew on the DB before the next deploy) must be SKIPPED,
  // never thrown on — a single unknown row used to TypeError every photo read
  // for the WP.
  it("skips rows whose phase is unknown to this build instead of throwing", () => {
    const rows = [
      row({ id: "a", phase: "after" }),
      row({ id: "x", phase: "some_future_phase" as PhotoLogRow["phase"] }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.after.map((r) => r.id)).toEqual(["a"]);
    expect(
      Object.values(result)
        .flat()
        .map((r) => r.id),
    ).toEqual(["a"]);
  });

  // Spec 248 — defect photos are a first-class bucket.
  it("groups defect-phase photos into their own bucket", () => {
    const rows = [
      row({ id: "d1", phase: "defect" as PhotoLogRow["phase"], rework_round: 1 }),
      row({ id: "f1", phase: "after_fix", rework_round: 1 }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.defect.map((r) => r.id)).toEqual(["d1"]);
    expect(result.after_fix.map((r) => r.id)).toEqual(["f1"]);
  });

  it("groups real photos by phase (incl. after_fix — feedback 0fa23307)", () => {
    const rows: PhotoLogRow[] = [
      row({ id: "a", phase: "before" }),
      row({ id: "b", phase: "during" }),
      row({ id: "c", phase: "after" }),
      row({ id: "d", phase: "before" }),
      row({ id: "e", phase: "after_fix" }),
    ];
    const result = selectCurrentPhotosByPhase(rows);
    expect(result.before.map((r) => r.id).sort()).toEqual(["a", "d"]);
    expect(result.during.map((r) => r.id)).toEqual(["b"]);
    expect(result.after.map((r) => r.id)).toEqual(["c"]);
    expect(result.after_fix.map((r) => r.id)).toEqual(["e"]);
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

// ============================================================================
// Spec 340 U2 — every photo carries a stable number.
//
// Operator, 2026-07-22: "We need to have a way to identify the images (id no.)".
// During the 291 rollout two thumbnails were circled in a screenshot and only one
// could be identified from the database — three photos shared the displayed
// minute. The UUID is unusable in the field.
//
// The number is DERIVED, not stored: an ordinal over the phase's non-tombstone
// rows by (created_at, id). photo_logs is append-only, so a removed photo's row
// never leaves the table — its number is retired and nothing renumbers. A stored
// column would have bought the same property for a migration plus a backfill.
// ============================================================================
describe("photo numbering — spec 340 U2", () => {
  it("numbers per phase, 1-based, in capture order", () => {
    const out = selectCurrentPhotosByPhase([
      row({ id: "d2", phase: "during", created_at: "2026-07-13T07:04:00Z" }),
      row({ id: "d1", phase: "during", created_at: "2026-07-11T07:58:00Z" }),
      row({ id: "b1", phase: "before", created_at: "2026-07-20T01:00:00Z" }),
    ]);
    expect(out.during.map((p) => [p.id, p.seq])).toEqual([
      ["d1", 1],
      ["d2", 2],
    ]);
    // Per phase, not per WP — a before photo taken last is still #1 of its zone.
    expect(out.before.map((p) => p.seq)).toEqual([1]);
  });

  it("retires a removed photo's number instead of renumbering the survivors", () => {
    const rows = [
      row({ id: "p1", phase: "during", created_at: "2026-07-11T01:00:00Z" }),
      row({ id: "p2", phase: "during", created_at: "2026-07-11T02:00:00Z" }),
      row({ id: "p3", phase: "during", created_at: "2026-07-11T03:00:00Z" }),
    ];
    expect(selectCurrentPhotosByPhase(rows).during.map((p) => p.seq)).toEqual([1, 2, 3]);

    // p2 is deleted: an append-only tombstone pointing at it. p3 must stay #3,
    // or every number quoted in a screenshot or a message goes stale on deletion.
    const afterDelete = selectCurrentPhotosByPhase([
      ...rows,
      row({
        id: "t2",
        phase: "during",
        storage_path: null,
        superseded_by: "p2",
        created_at: "2026-07-22T05:00:00Z",
      }),
    ]);
    expect(afterDelete.during.map((p) => [p.id, p.seq])).toEqual([
      ["p1", 1],
      ["p3", 3],
    ]);
  });

  it("never lets a tombstone consume a number", () => {
    const out = selectCurrentPhotosByPhase([
      row({
        id: "t0",
        phase: "during",
        storage_path: null,
        superseded_by: "gone",
        created_at: "2026-07-01T00:00:00Z",
      }),
      row({ id: "p1", phase: "during", created_at: "2026-07-02T00:00:00Z" }),
    ]);
    expect(out.during.map((p) => p.seq)).toEqual([1]);
  });

  it("returns each phase ordered by that number, whatever order the rows arrive in", () => {
    // The read has no `order by` (PostgREST select *), so row order is not
    // guaranteed — a number rendered in a random grid position is worse than no
    // number at all.
    const out = selectCurrentPhotosByPhase([
      row({ id: "c", phase: "after", created_at: "2026-07-03T00:00:00Z" }),
      row({ id: "a", phase: "after", created_at: "2026-07-01T00:00:00Z" }),
      row({ id: "b", phase: "after", created_at: "2026-07-02T00:00:00Z" }),
    ]);
    expect(out.after.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(out.after.map((p) => p.seq)).toEqual([1, 2, 3]);
  });

  it("breaks a created_at tie by id so two same-second photos never swap numbers", () => {
    const out = selectCurrentPhotosByPhase([
      row({ id: "zz", phase: "during", created_at: "2026-07-13T07:04:00Z" }),
      row({ id: "aa", phase: "during", created_at: "2026-07-13T07:04:00Z" }),
    ]);
    expect(out.during.map((p) => [p.id, p.seq])).toEqual([
      ["aa", 1],
      ["zz", 2],
    ]);
  });
  // Spec 340 U2 fresh-eyes catch: the tile LABELS captured_at_client ?? created_at
  // (page.tsx), but numbering by created_at alone would order by upload time. The
  // ADR 0039 offline queue can flush minutes-to-hours after capture, so a queued
  // photo would take a higher number than photos captured after it — and since the
  // grid is now SORTED by that number, the times would render visibly out of order.
  it("numbers by capture time, not upload time, so an offline flush cannot reorder the grid", () => {
    const out = selectCurrentPhotosByPhase([
      row({
        id: "queued",
        phase: "during",
        captured_at_client: "2026-07-13T07:00:00Z",
        created_at: "2026-07-13T09:30:00Z", // uploaded much later
      }),
      row({
        id: "live",
        phase: "during",
        captured_at_client: "2026-07-13T08:00:00Z",
        created_at: "2026-07-13T08:00:05Z",
      }),
    ]);
    expect(out.during.map((p) => [p.id, p.seq])).toEqual([
      ["queued", 1],
      ["live", 2],
    ]);
  });
});
