// Spec 256 U1 — per-day photo activity. Same current-photo read as
// activity-span (ADR 0009 anti-join + ADR 0015 tombstone), but aggregated to
// Map<isoDate, Map<wpId, photoCount>> for the calendar views.

import { describe, expect, it } from "vitest";
import { activityDays, type ActivityPhotoRow } from "@/lib/work-packages/activity-days";

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

describe("activityDays", () => {
  it("empty input → empty map", () => {
    expect(activityDays([]).size).toBe(0);
  });

  it("counts photos per WP per Bangkok day (dateline crossing)", () => {
    // 18:30Z = next day 01:30 Bangkok
    const days = activityDays([
      row({ created_at: "2026-06-15T05:00:00.000Z" }),
      row({ created_at: "2026-06-15T18:30:00.000Z" }),
      row({ created_at: "2026-06-15T06:00:00.000Z", work_package_id: WP_B }),
    ]);
    expect(days.get("2026-06-15")?.get(WP_A)).toBe(1);
    expect(days.get("2026-06-16")?.get(WP_A)).toBe(1);
    expect(days.get("2026-06-15")?.get(WP_B)).toBe(1);
  });

  it("multiple photos same WP same day accumulate", () => {
    const days = activityDays([
      row({ created_at: "2026-06-15T03:00:00.000Z" }),
      row({ created_at: "2026-06-15T05:00:00.000Z" }),
      row({ created_at: "2026-06-15T07:00:00.000Z" }),
    ]);
    expect(days.get("2026-06-15")?.get(WP_A)).toBe(3);
  });

  it("prefers captured_at_client over created_at", () => {
    const days = activityDays([
      row({
        captured_at_client: "2026-06-10T03:00:00.000Z",
        created_at: "2026-06-15T05:00:00.000Z",
      }),
    ]);
    expect(days.get("2026-06-10")?.get(WP_A)).toBe(1);
    expect(days.has("2026-06-15")).toBe(false);
  });

  it("supersede chain counts only the head; tombstone removes its target", () => {
    const a = row({ created_at: "2026-06-01T05:00:00.000Z" });
    const b = row({ created_at: "2026-06-10T05:00:00.000Z", superseded_by: a.id });
    const kept = row({ created_at: "2026-06-20T05:00:00.000Z", work_package_id: WP_B });
    const tomb = row({
      storage_path: null,
      superseded_by: kept.id,
      created_at: "2026-06-25T05:00:00.000Z",
      work_package_id: WP_B,
    });
    const days = activityDays([a, b, kept, tomb]);
    // chain: b is the head → only 2026-06-10 counts for WP_A
    expect(days.has("2026-06-01")).toBe(false);
    expect(days.get("2026-06-10")?.get(WP_A)).toBe(1);
    // kept was tombstoned → gone entirely; tombstone itself never counts
    expect(days.has("2026-06-20")).toBe(false);
    expect(days.has("2026-06-25")).toBe(false);
  });
});
