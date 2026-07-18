// Writing failing test first.
//
// Spec 327 U1 — the late-risk SSOT (one definition, three consumers: U1 counts,
// U2 per-WP row state, U3 list). A PR is เสี่ยงช้า when ALL hold: it sits in an
// ACTIVE_REQUEST_BANDS band, its eta is non-null, its ANCHOR work package
// (work_package_id ?? requested_from_work_package_id — ADR 0065; a bare
// work_package_id join silently drops every modern store-bound PR) has a
// non-null planned_start, and eta > planned_start (ISO string compare). v1 uses
// PR.eta only (purchase_order_deliveries.eta deferred — no project/WP column).

import { describe, expect, it } from "vitest";

import {
  anchorWorkPackageId,
  countLateRisk,
  selectLateRisk,
  type LateRiskRow,
} from "@/lib/purchasing/late-risk";

const WPS = new Map([
  ["wp-early", { plannedStart: "2026-07-10" }],
  ["wp-late", { plannedStart: "2026-08-01" }],
  ["wp-undated", { plannedStart: null }],
]);

function pr(overrides: Partial<LateRiskRow>): LateRiskRow {
  return {
    status: "approved", // to_order — an active band
    eta: "2026-07-20",
    workPackageId: "wp-early",
    requestedFromWorkPackageId: null,
    ...overrides,
  };
}

describe("anchorWorkPackageId (ADR 0065 coalesce)", () => {
  it("prefers work_package_id when set", () => {
    expect(anchorWorkPackageId(pr({ requestedFromWorkPackageId: "wp-late" }))).toBe("wp-early");
  });

  it("falls back to requested_from_work_package_id (store-bound PR)", () => {
    expect(
      anchorWorkPackageId(pr({ workPackageId: null, requestedFromWorkPackageId: "wp-late" })),
    ).toBe("wp-late");
  });

  it("is null when both anchors are null (project-grain PR)", () => {
    expect(
      anchorWorkPackageId(pr({ workPackageId: null, requestedFromWorkPackageId: null })),
    ).toBeNull();
  });
});

describe("selectLateRisk", () => {
  it("flags an active-band PR whose eta lands after its anchor WP's planned_start", () => {
    const rows = [pr({ eta: "2026-07-20", workPackageId: "wp-early" })];
    expect(selectLateRisk(rows, WPS)).toHaveLength(1);
  });

  it("does not flag eta on or before planned_start", () => {
    const onStart = pr({ eta: "2026-07-10", workPackageId: "wp-early" });
    const before = pr({ eta: "2026-07-01", workPackageId: "wp-early" });
    expect(selectLateRisk([onStart, before], WPS)).toHaveLength(0);
  });

  it("does not flag a null-eta PR (that's the ไม่ทราบวันถึง shelf, not late-risk)", () => {
    expect(selectLateRisk([pr({ eta: null })], WPS)).toHaveLength(0);
  });

  it("does not flag when the anchor WP is undated or unknown", () => {
    const undated = pr({ workPackageId: "wp-undated" });
    const unknown = pr({ workPackageId: "wp-not-in-map" });
    const anchorless = pr({ workPackageId: null, requestedFromWorkPackageId: null });
    expect(selectLateRisk([undated, unknown, anchorless], WPS)).toHaveLength(0);
  });

  it("covers ALL active bands, not just in_transit (an already-late PR still awaiting approval is the earliest warning)", () => {
    const rows = [
      pr({ status: "requested" }), // awaiting_approval
      pr({ status: "approved" }), // to_order
      pr({ status: "on_route" }), // in_transit
      pr({ status: "purchased" }), // in_transit
    ];
    expect(selectLateRisk(rows, WPS)).toHaveLength(4);
  });

  it("excludes done/closed bands even with a late eta", () => {
    const rows = [
      pr({ status: "delivered" }),
      pr({ status: "site_purchased" }),
      pr({ status: "rejected" }),
      pr({ status: "cancelled" }),
    ];
    expect(selectLateRisk(rows, WPS)).toHaveLength(0);
  });

  it("INCLUDES a work_package_id-NULL / requested_from-set PR (the anchor-coalesce assertion)", () => {
    const storeBound = pr({
      workPackageId: null,
      requestedFromWorkPackageId: "wp-early",
      eta: "2026-07-20",
    });
    expect(selectLateRisk([storeBound], WPS)).toHaveLength(1);
  });

  it("returns the flagged rows themselves (consumers render them)", () => {
    const flagged = pr({ eta: "2026-09-01", workPackageId: "wp-late" });
    const fine = pr({ eta: "2026-07-01", workPackageId: "wp-late" });
    expect(selectLateRisk([flagged, fine], WPS)).toEqual([flagged]);
  });
});

describe("countLateRisk", () => {
  it("equals the flagged-row count", () => {
    const rows = [
      pr({ eta: "2026-07-20" }),
      pr({ eta: "2026-07-01" }),
      pr({ workPackageId: null, requestedFromWorkPackageId: "wp-early" }),
    ];
    expect(countLateRisk(rows, WPS)).toBe(2);
  });
});
