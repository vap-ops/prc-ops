// Writing failing test first.
//
// Spec 306 grain-coverage — the muster WP picker offers LEAF (งานย่อย) WPs so the
// close-day derive can bind labor_logs (the DB forbids binding to a group งาน WP).
// A project has hundreds of leaves under a few dozen งาน, so the picker groups them:
// groupMusterWps folds the flat leaf list into one collapsible group per parent งาน
// (header = parent code + name), plus a trailing null-parent bucket for standalone
// leaf main-WPs. Named groups sort by parent code; children sort by their own code.

import { describe, expect, it } from "vitest";

import { groupMusterWps, pickerWps } from "@/lib/muster/wp-groups";
import type { MusterWp } from "@/lib/muster/wp-groups";
import { Constants } from "@/lib/db/database.types";

const P5 = { parentId: "p5", parentCode: "WP-05", parentName: "งานพื้น" };
const P7 = { parentId: "p7", parentCode: "WP-07", parentName: "งานสี" };

const WPS: MusterWp[] = [
  { id: "l1", code: "W05-02", name: "ปูกระเบื้อง", status: "in_progress", ...P5 },
  { id: "l2", code: "W05-01", name: "เทปูน", status: "not_started", ...P5 },
  { id: "l3", code: "W07-01", name: "ทาสีรองพื้น", status: "complete", ...P7 },
  {
    id: "s1",
    code: "W99",
    name: "งานเบ็ดเตล็ด",
    status: "pending_approval",
    parentId: null,
    parentCode: null,
    parentName: null,
  },
];

describe("groupMusterWps", () => {
  it("folds leaves into one group per parent งาน, headers carry the parent code + name", () => {
    const groups = groupMusterWps(WPS);
    // Two named parents (WP-05, WP-07) + one null-parent bucket.
    expect(groups).toHaveLength(3);
    const p5 = groups.find((g) => g.parentId === "p5")!;
    expect(p5.parentCode).toBe("WP-05");
    expect(p5.parentName).toBe("งานพื้น");
    // Children sorted by their OWN code, not input order.
    expect(p5.children.map((c) => c.id)).toEqual(["l2", "l1"]);
  });

  it("named groups sort by parent code; the null-parent (standalone) bucket sorts LAST", () => {
    const groups = groupMusterWps(WPS);
    expect(groups.map((g) => g.parentId)).toEqual(["p5", "p7", null]);
    const standalone = groups[groups.length - 1]!;
    expect(standalone.parentId).toBeNull();
    expect(standalone.parentCode).toBeNull();
    expect(standalone.children.map((c) => c.id)).toEqual(["s1"]);
  });

  it("returns no null-parent bucket when every leaf has a parent", () => {
    const groups = groupMusterWps(WPS.filter((w) => w.parentId !== null));
    expect(groups.map((g) => g.parentId)).toEqual(["p5", "p7"]);
    expect(groups.some((g) => g.parentId === null)).toBe(false);
  });

  it("empty input → empty groups", () => {
    expect(groupMusterWps([])).toEqual([]);
  });
});

// Spec 357 U-B — the picker offers only INCOMPLETE leaves, but a leaf the team
// already has assigned stays offered regardless of status (the #742 invariant:
// an assigned WP must remain visible/removable even after it completes).
describe("pickerWps (spec 357 U-B)", () => {
  it("excludes a complete leaf that is not assigned", () => {
    expect(pickerWps(WPS, []).map((w) => w.id)).toEqual(["l1", "l2", "s1"]);
  });

  it("keeps a complete leaf that IS assigned (#742 invariant)", () => {
    expect(pickerWps(WPS, ["l3"]).map((w) => w.id)).toEqual(["l1", "l2", "l3", "s1"]);
  });

  it("offers every non-complete status in the live enum (exhaustive domain)", () => {
    // Iterate the GENERATED enum, never a hand list — a future enum value must
    // flow through this test without a manual update (allowlist-test lesson).
    const all = Constants.public.Enums.work_package_status;
    const wps: MusterWp[] = all.map((status, i) => ({
      id: `w${i}`,
      code: `W-${i}`,
      name: status,
      status,
      parentId: null,
      parentCode: null,
      parentName: null,
    }));
    const offered = pickerWps(wps, []).map((w) => w.status);
    expect(offered.sort()).toEqual(all.filter((s) => s !== "complete").sort());
  });
});
