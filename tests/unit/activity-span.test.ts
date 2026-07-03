// Spec 255 U1 — per-WP activity spans from photo evidence. Pure function over
// minimal photo_logs rows: current-photo filter per ADR 0009/0015 (anti-join +
// tombstone), photo date = Bangkok calendar date of captured_at_client ??
// created_at, output = per-WP min/max ISO date.

import { describe, expect, it } from "vitest";
import { activitySpans, type ActivityPhotoRow } from "@/lib/work-packages/activity-span";

const WP_A = "11111111-1111-4111-8111-111111111111";
const WP_B = "22222222-2222-4222-8222-222222222222";

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

describe("activitySpans", () => {
  it("returns empty map for no rows", () => {
    expect(activitySpans([]).size).toBe(0);
  });

  it("single photo → one-day span from created_at (Bangkok date)", () => {
    // 2026-06-15T18:30Z = 2026-06-16 01:30 Bangkok — crosses the date line.
    const spans = activitySpans([row({ created_at: "2026-06-15T18:30:00.000Z" })]);
    expect(spans.get(WP_A)).toEqual({ firstIso: "2026-06-16", lastIso: "2026-06-16" });
  });

  it("prefers captured_at_client over created_at", () => {
    const spans = activitySpans([
      row({
        captured_at_client: "2026-06-10T03:00:00.000Z",
        created_at: "2026-06-15T05:00:00.000Z",
      }),
    ]);
    expect(spans.get(WP_A)).toEqual({ firstIso: "2026-06-10", lastIso: "2026-06-10" });
  });

  it("spans min..max across photos and groups per WP", () => {
    const spans = activitySpans([
      row({ created_at: "2026-06-01T05:00:00.000Z" }),
      row({ created_at: "2026-06-20T05:00:00.000Z" }),
      row({ created_at: "2026-06-10T05:00:00.000Z" }),
      row({ work_package_id: WP_B, created_at: "2026-07-01T05:00:00.000Z" }),
    ]);
    expect(spans.get(WP_A)).toEqual({ firstIso: "2026-06-01", lastIso: "2026-06-20" });
    expect(spans.get(WP_B)).toEqual({ firstIso: "2026-07-01", lastIso: "2026-07-01" });
    expect(spans.size).toBe(2);
  });

  it("supersede chain A→B→C counts only the head (C)", () => {
    const a = row({ created_at: "2026-06-01T05:00:00.000Z" });
    const b = row({ created_at: "2026-06-10T05:00:00.000Z", superseded_by: a.id });
    const c = row({ created_at: "2026-06-20T05:00:00.000Z", superseded_by: b.id });
    const spans = activitySpans([a, b, c]);
    expect(spans.get(WP_A)).toEqual({ firstIso: "2026-06-20", lastIso: "2026-06-20" });
  });

  it("tombstone removes its target and never counts itself", () => {
    const a = row({ created_at: "2026-06-05T05:00:00.000Z" });
    const tomb = row({
      storage_path: null,
      superseded_by: a.id,
      created_at: "2026-06-25T05:00:00.000Z",
    });
    const spans = activitySpans([a, tomb]);
    expect(spans.has(WP_A)).toBe(false);
  });

  it("skips rows whose timestamps do not parse", () => {
    const spans = activitySpans([
      row({ created_at: "not-a-date" }),
      row({ created_at: "2026-06-12T05:00:00.000Z" }),
    ]);
    expect(spans.get(WP_A)).toEqual({ firstIso: "2026-06-12", lastIso: "2026-06-12" });
  });
});
