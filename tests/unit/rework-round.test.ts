// Spec 216 U3 — read-side helpers for the rework-round dimension: group after_fix
// photos by their cycle, and map each round to the defect reason that opened it.

import { describe, it, expect } from "vitest";
import {
  photoReworkRoundFor,
  groupAfterFixByRound,
  reworkReasonsFromAuditRows,
  reworkSourcesFromAuditRows,
  reworkRoundTag,
  afterFixRoundHeading,
  afterFixSectionLabel,
  photoSectionLabel,
  type AfterFixRoundGroup,
} from "@/lib/photos/rework-round";
import { AFTER_FIX_LEGACY_LABEL, PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";
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
    answers_photo_id: null,
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

describe("reworkRoundTag / afterFixRoundHeading", () => {
  it("tags a round", () => {
    expect(reworkRoundTag(2)).toBe("รอบ 2");
  });

  it("builds a per-round heading, dropping the round for legacy round 0", () => {
    expect(afterFixRoundHeading("หลังแก้ไข", 1)).toBe("หลังแก้ไข — รอบ 1");
    expect(afterFixRoundHeading("หลังแก้ไข", 0)).toBe("หลังแก้ไข");
  });

  it("appends the source label when known, omits it when null (spec 217)", () => {
    expect(afterFixRoundHeading("หลังแก้ไข", 2, "ลูกค้าแจ้ง")).toBe(
      "หลังแก้ไข — รอบ 2 · ลูกค้าแจ้ง",
    );
    expect(afterFixRoundHeading("หลังแก้ไข", 2, null)).toBe("หลังแก้ไข — รอบ 2");
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

describe("reworkSourcesFromAuditRows", () => {
  it("maps each round to its source (internal/client)", () => {
    const map = reworkSourcesFromAuditRows([
      { payload: { event: "wp_reopened_for_defect", round: 1, source: "internal" } },
      { payload: { event: "wp_reopened_for_defect", round: 2, source: "client" } },
    ]);
    expect(map.get(1)).toBe("internal");
    expect(map.get(2)).toBe("client");
    expect(map.size).toBe(2);
  });

  it("skips rows with an invalid/missing source or round (legacy reopens have none)", () => {
    const map = reworkSourcesFromAuditRows([
      { payload: { round: 1, source: "bogus" } },
      { payload: { round: 2 } },
      { payload: { source: "client" } },
      { payload: null },
    ]);
    expect(map.size).toBe(0);
  });
});

// Operator directive 2026-07-28 — "hide rework and only show it if there is a rework
// rejection". The inventory found rework is already conditional everywhere EXCEPT the
// after_fix history section, which is gated only on "this WP has after_fix photos".
// That put the หลังแก้ไข name on 21 WPs that were never sent back (151 photos, all
// round 0 — the pre-spec-353 free-capture legacy). Operator's call: keep the photos,
// drop the rework name. Round is the discriminator because it is per-GROUP: a WP that
// really did rework can still carry a round-0 legacy group, and that group is still
// not rework evidence.
describe("afterFixSectionLabel — round 0 is legacy, not rework (2026-07-28)", () => {
  it("names a round-0 group plainly, with no rework vocabulary", () => {
    expect(afterFixSectionLabel(0)).toBe(AFTER_FIX_LEGACY_LABEL);
    expect(afterFixSectionLabel(0)).not.toBe(PHOTO_PHASE_LABEL.after_fix);
    expect(afterFixSectionLabel(0)).not.toContain("แก้ไข");
  });

  it("names every real rework round หลังแก้ไข", () => {
    for (const round of [1, 2, 3, 7]) {
      expect(afterFixSectionLabel(round)).toBe(PHOTO_PHASE_LABEL.after_fix);
    }
  });

  it("composes with afterFixRoundHeading — legacy stays bare, real rounds keep รอบ N", () => {
    expect(afterFixRoundHeading(afterFixSectionLabel(0), 0)).toBe(AFTER_FIX_LEGACY_LABEL);
    expect(afterFixRoundHeading(afterFixSectionLabel(2), 2)).toBe(
      `${PHOTO_PHASE_LABEL.after_fix} — ${reworkRoundTag(2)}`,
    );
  });
});

// Sibling sweep, same session: after the capture zone, the review detail and the
// ประวัติ timeline, a FOURTH surface named a photo by its phase — the removal trace
// ("หลังแก้ไข #4 · ลบโดย …"). Latent today (prod holds zero removed after_fix rows),
// but it would re-introduce the exact vocabulary on the next deletion. Rather than a
// fourth copy of the same branch, the phase→name rule lives here once.
describe("photoSectionLabel — one home for the phase→name rule", () => {
  it("routes ONLY after_fix through the round; every other phase keeps its own label", () => {
    for (const round of [0, 1, 3]) {
      expect(photoSectionLabel("before", round)).toBe(PHOTO_PHASE_LABEL.before);
      expect(photoSectionLabel("during", round)).toBe(PHOTO_PHASE_LABEL.during);
      expect(photoSectionLabel("after", round)).toBe(PHOTO_PHASE_LABEL.after);
      expect(photoSectionLabel("defect", round)).toBe(PHOTO_PHASE_LABEL.defect);
    }
  });

  it("names after_fix by the round, agreeing with afterFixSectionLabel", () => {
    expect(photoSectionLabel("after_fix", 0)).toBe(AFTER_FIX_LEGACY_LABEL);
    expect(photoSectionLabel("after_fix", 1)).toBe(PHOTO_PHASE_LABEL.after_fix);
    for (const round of [0, 2, 5]) {
      expect(photoSectionLabel("after_fix", round)).toBe(afterFixSectionLabel(round));
    }
  });

  it("degrades an unknown phase to itself rather than blank", () => {
    // The enum can grow; a silent empty heading would hide that photos exist.
    expect(photoSectionLabel("brand_new_phase", 0)).toBe("brand_new_phase");
  });
});
