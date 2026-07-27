// Writing failing test first.
//
// Spec 363 U4 merge — the three WP-detail tabs (คำขอซื้อ · เบิกของ ·
// ค่าใช้จ่ายหน้างาน) are DELETED here. The spec's own precondition block says a
// tab may not go before its per-issue affordances have a new home, so this file
// pins both halves:
//
//   1. `showsIssueActions` — which of an issue's rendered rows owns its actions.
//      An issue can appear TWICE in the ของ list (partly here, partly returned);
//      rendering ยืนยันรับแทน / แก้รายการที่บันทึกผิด on both would put two live
//      controls over one `stock_issues` row. Exactly one row must own them, and a
//      fully-returned issue — which never reaches อยู่ที่งานนี้ — must still be
//      correctable, or แก้รายการที่บันทึกผิด becomes unreachable for it.
//   2. The deletion itself. The tab array is Server Component JSX vitest cannot
//      render, so it is pinned by source with comments stripped — a comment
//      NAMING a deleted tab must not keep the pin green (and this file's own
//      subject matter guarantees such comments exist).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  showsIssueActions,
  WP_THING_GROUPS,
  type WpThingGroupKey,
  type WpThingIssue,
} from "@/lib/work-packages/things";
import { allowedNeedPaths } from "@/lib/work-packages/need-path";
import { WP_DETAIL_ROLES, isReadOnlyWpViewer } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

function issue(over: Partial<WpThingIssue> = {}): WpThingIssue {
  return {
    id: "i1",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    qty: 5,
    returnedQty: 0,
    issuedAt: "2026-07-23T03:00:00Z",
    receiverName: null,
    receivedAt: null,
    unitCost: 120,
    ...over,
  };
}

/** The groups an issue actually renders into — mirrors groupWpThings' rule. */
function groupsFor(i: WpThingIssue): WpThingGroupKey[] {
  const out: WpThingGroupKey[] = [];
  if (i.qty - i.returnedQty > 0) out.push("here");
  if (i.returnedQty > 0) out.push("returned");
  return out;
}

describe("showsIssueActions", () => {
  it("gives the actions to อยู่ที่งานนี้ when any of the issue is still here", () => {
    expect(showsIssueActions(issue({ qty: 5, returnedQty: 0 }), "here")).toBe(true);
    expect(showsIssueActions(issue({ qty: 5, returnedQty: 3 }), "here")).toBe(true);
  });

  it("does NOT repeat them on the คืนแล้ว reading of a partly-returned issue", () => {
    // Same stock_issues row, two rows on screen. Two แก้รายการที่บันทึกผิด buttons
    // over one issue is a double-submit invitation and reads as two withdrawals.
    expect(showsIssueActions(issue({ qty: 5, returnedQty: 3 }), "returned")).toBe(false);
  });

  it("gives them to คืนแล้ว when the issue is FULLY returned", () => {
    // A fully-returned issue never reaches อยู่ที่งานนี้. Without this arm its
    // แก้รายการที่บันทึกผิด has no home at all once เบิกของ is deleted — which is
    // exactly the removal the precondition block forbids.
    expect(showsIssueActions(issue({ qty: 5, returnedQty: 5 }), "returned")).toBe(true);
  });

  it("offers them from exactly ONE rendered row, for every issue shape", () => {
    const shapes = [
      issue({ qty: 5, returnedQty: 0 }),
      issue({ qty: 5, returnedQty: 1 }),
      issue({ qty: 5, returnedQty: 5 }),
      issue({ qty: 1, returnedQty: 1 }),
    ];
    for (const i of shapes) {
      const owners = groupsFor(i).filter((g) => showsIssueActions(i, g));
      expect(owners).toHaveLength(1);
    }
  });

  it("never offers them from a request-only group", () => {
    // Iterate the COMPLETE group domain rather than a hand-typed list, so a group
    // added later cannot quietly start rendering write controls.
    const itemGroups: WpThingGroupKey[] = ["here", "returned"];
    for (const g of WP_THING_GROUPS) {
      if (itemGroups.includes(g.key)) continue;
      expect(showsIssueActions(issue({ qty: 5, returnedQty: 5 }), g.key)).toBe(false);
    }
  });
});

describe("WP detail page — the three tabs are gone", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("no longer declares the คำขอซื้อ, เบิกของ or ค่าใช้จ่ายหน้างาน tabs", () => {
    // Pinned on the tab-array KEYS, not the Thai labels: "คำขอซื้อ" also occurs in
    // the pending-requests chip ("คำขอซื้อรออนุมัติ"), which stays, so a label
    // assertion would pass on a page that still renders the tab.
    expect(src).not.toContain('key: "purchases"');
    expect(src).not.toContain('key: "issue"');
    expect(src).not.toContain("SITE_EXPENSE_TAB_LABEL");
  });

  it("keeps ของ as the one item surface", () => {
    expect(src).toContain('key: "things"');
    expect(src.split("WpNeedSheet").length - 1).toBeGreaterThanOrEqual(2);
    expect(src.split("WpThingsView").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("re-points the request and withdrawal deep links at ของ", () => {
    // #wp-requests is linked from /sa and from this page's own pending chip;
    // leaving it mapped at a deleted tab key would silently do nothing.
    expect(src).toContain('"wp-requests": "things"');
    expect(src).toContain('"wp-issue": "things"');
  });

  it("routes the per-path gate through allowedNeedPaths rather than inlining it", () => {
    // Import PLUS a real call site. The DECISION is asserted over the complete
    // role domain in the block below — a source pin can only ever prove the call
    // exists, never that it is right.
    expect(src.split("allowedNeedPaths").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain("allowedNeedPaths(ctx.role)");
  });
});

// The gate lives in Server Component JSX vitest cannot render, so the branch is a
// pure function and THIS is its real coverage. Iterating the complete domain (a
// Record<UserRole>, so an enum-add trips its own guard first) rather than a
// hand-typed list: a role added later must not quietly acquire, or quietly lose,
// a write path on this page.
describe("allowedNeedPaths", () => {
  it("restricts exactly ONE role — plain procurement", () => {
    expect(ALL_ROLES.filter((r) => allowedNeedPaths(r) !== null).sort()).toEqual(["procurement"]);
  });

  it("gives that role the purchase request and nothing else", () => {
    // Its one write on this page. `issue_stock` excludes it and the self-purchase
    // RPC is a site-staff surface, so offering either would be offer-then-refuse.
    expect(allowedNeedPaths("procurement")).toEqual(["request"]);
  });

  it("leaves every other WP-detail role unrestricted", () => {
    // null = "no restriction", NOT "no paths" — an empty array would silently
    // close the sheet for everyone.
    for (const role of WP_DETAIL_ROLES) {
      if (role === "procurement") continue;
      expect(allowedNeedPaths(role)).toBeNull();
    }
  });

  it("does not restrict procurement_manager, who has SA capture parity", () => {
    // Spec 348 U4 cleared her readOnly flag; she withdraws and records like an SA.
    expect(allowedNeedPaths("procurement_manager")).toBeNull();
  });

  it("agrees with isReadOnlyWpViewer, which is what the page branches on", () => {
    for (const role of ALL_ROLES) {
      expect(allowedNeedPaths(role) !== null).toBe(isReadOnlyWpViewer(role));
    }
  });
});
