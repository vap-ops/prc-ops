// Spec 216 U3 — read-side helpers for the rework-round dimension: group after_fix
// photos by their cycle, and map each round to the defect reason that opened it.

import { describe, it, expect } from "vitest";
import {
  photoReworkRoundFor,
  groupAfterFixByRound,
  reworkReasonsFromAuditRows,
  type AfterFixRoundGroup,
} from "@/lib/photos/rework-round";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

function photo(id: string, round: number): PhotoLogRow {
  return {
    id,
    work_package_id: "wp1",
    phase: "after_fix",
    storage_path: `path/${id}.jpg`,
    superseded_by: null,
    uploaded_by: "u1",
    created_at: "2026-06-28T00:00:00Z",
    captured_at_client: null,
    rework_round: round,
  };
}

describe("photoReworkRoundFor", () => {
  it("after_fix carries the WP round; other phases are 0", () => {
    expect(photoReworkRoundFor("after_fix", 2)).toBe(2);
    expect(photoReworkRoundFor("after", 2)).toBe(0);
  });
});

describe("groupAfterFixByRound", () => {
  it("groups after_fix photos by rework_round, ascending", () => {
    const rows = [photo("a", 2), photo("b", 1), photo("c", 2), photo("d", 1)];
    const groups: AfterFixRoundGroup[] = groupAfterFixByRound(rows);
    expect(groups.map((g) => g.round)).toEqual([1, 2]);
    expect(groups[0]?.photos.map((p) => p.id)).toEqual(["b", "d"]);
    expect(groups[1]?.photos.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("returns an empty list when there are no after_fix photos", () => {
    expect(groupAfterFixByRound([])).toEqual([]);
  });

  it("preserves input order within a round", () => {
    const rows = [photo("x", 1), photo("y", 1), photo("z", 1)];
    expect(groupAfterFixByRound(rows)[0]?.photos.map((p) => p.id)).toEqual(["x", "y", "z"]);
  });
});

describe("reworkReasonsFromAuditRows", () => {
  it("maps each round to its reopen reason", () => {
    const map = reworkReasonsFromAuditRows([
      { payload: { event: "wp_reopened_for_defect", reason: "รอยร้าว", round: 1 } },
      { payload: { event: "wp_reopened_for_defect", reason: "พื้นไม่เรียบ", round: 2 } },
    ]);
    expect(map.get(1)).toBe("รอยร้าว");
    expect(map.get(2)).toBe("พื้นไม่เรียบ");
    expect(map.size).toBe(2);
  });

  it("skips rows without a numeric round or a reason", () => {
    const map = reworkReasonsFromAuditRows([
      { payload: { event: "wp_reopened_for_defect", reason: "ok", round: 1 } },
      { payload: { event: "other", reason: "x" } },
      { payload: { event: "wp_reopened_for_defect", round: 2 } },
      { payload: null },
    ]);
    expect(map.get(1)).toBe("ok");
    expect(map.has(2)).toBe(false);
    expect(map.size).toBe(1);
  });
});
