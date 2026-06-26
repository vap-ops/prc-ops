// Pure validators behind the createPurchaseRequest / decidePurchaseRequest
// server actions (feature spec 09 / ADR 0022). The DB CHECK constraints are
// the security authority — these tests pin down the UX-side rules so the
// form can show inline errors before the round-trip. They must mirror the
// SQL CHECKs:
//   item_description / unit: length(trim(...)) > 0
//   quantity: > 0
//   decision_comment (when status = 'rejected'): non-null and non-blank
// Spec 176 U4: reasonCode is now required (the reactive-reason tag). It is
// validated LAST, so the earlier-field error cases below still surface their
// intended message when reasonCode is omitted.

import { describe, it, expect } from "vitest";
import {
  validateCreatePurchaseRequest,
  toStoreBoundPurchase,
  isDecisionCommentValid,
  commentRequiredForDecision,
  isPurchaseDecision,
  isPurchasePriority,
  PURCHASE_DECISIONS,
  PURCHASE_PRIORITIES,
} from "@/lib/purchasing/validate-purchase-request";
import { PURCHASE_REASON_CODES, isPurchaseReasonCode } from "@/lib/purchasing/reason-code";

const VALID_WP = "11111111-2222-3333-4444-555555555555";
// Spec 195 P1: a project the PR is scoped to (WP-less = "ทั้งโครงการ / เข้าสโตร์").
const VALID_PROJECT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VALID_REASON = "unplanned_miss";
// Spec 179: a catalog_items.id the request may link to (uuid-or-null).
const VALID_CATALOG_ITEM = "99999999-8888-7777-6666-555555555555";

// Today in Asia/Bangkok, computed at runtime (the validator has a clock
// dependence — spec 16 §2). Tests build relative dates from this so the
// midnight-Bangkok boundary can't flake them.
function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("validateCreatePurchaseRequest", () => {
  it("accepts a typical valid input (neededBy defaults null, priority defaults normal)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement bag 50kg",
      quantity: 10,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        // Spec 195 P1: WP-bound PR — projectId is left null (the DB derives it
        // from the WP); callers may still pass it (the form does).
        projectId: null,
        workPackageId: VALID_WP,
        itemDescription: "Cement bag 50kg",
        quantity: 10,
        unit: "bag",
        neededBy: null,
        priority: "normal",
        notes: null,
        reasonCode: VALID_REASON,
        // Spec 179: no catalog link unless one is picked.
        catalogItemId: null,
      },
    });
  });

  // Spec 195 P1 — the work package is now OPTIONAL; a PR may be scoped to the
  // whole project ("ทั้งโครงการ / เข้าสโตร์") with work_package_id null. Exactly
  // one scope is required: a WP (project derived) OR a project (WP-less).
  it("accepts a WP-less project-level request (projectId set, workPackageId omitted)", () => {
    const r = validateCreatePurchaseRequest({
      projectId: VALID_PROJECT,
      itemDescription: "Cement bag 50kg",
      quantity: 10,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.workPackageId).toBeNull();
      expect(r.value.projectId).toBe(VALID_PROJECT);
    }
  });

  it("collapses null/blank workPackageId to null when a projectId is given", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const r = validateCreatePurchaseRequest({
        projectId: VALID_PROJECT,
        workPackageId: empty,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        reasonCode: VALID_REASON,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.workPackageId).toBeNull();
    }
  });

  it("echoes both ids when a WP-bound request also carries its projectId (form path)", () => {
    const r = validateCreatePurchaseRequest({
      projectId: VALID_PROJECT,
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.workPackageId).toBe(VALID_WP);
      expect(r.value.projectId).toBe(VALID_PROJECT);
    }
  });

  it("rejects a request with neither a workPackageId nor a projectId", () => {
    const r = validateCreatePurchaseRequest({
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/งานหรือโครงการ/);
  });

  it("rejects a malformed projectId", () => {
    const r = validateCreatePurchaseRequest({
      projectId: "not-a-uuid",
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/โครงการ/);
  });

  // Spec 179 — optional catalog link (catalog_item_id FK). uuid echoes through;
  // omitted/null/blank collapses to null (off-catalog free-text request); a
  // malformed id is rejected (mirrors the DB FK being a uuid).
  it("echoes a valid catalogItemId through", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "เหล็กข้ออ้อย 12 มิล",
      quantity: 20,
      unit: "ท่อน",
      reasonCode: VALID_REASON,
      catalogItemId: VALID_CATALOG_ITEM,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.catalogItemId).toBe(VALID_CATALOG_ITEM);
  });

  it("collapses omitted/null/blank catalogItemId to null (off-catalog request)", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        reasonCode: VALID_REASON,
        catalogItemId: empty,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.catalogItemId).toBeNull();
    }
  });

  it("rejects a malformed catalogItemId with the Thai message", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
      catalogItemId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/วัสดุในแคตตาล็อก/);
  });

  // Spec 48: requester notes — optional free text, trimmed, blank → null,
  // server-side 1000-char cap (spec-36 shape; DB CHECK stays queued).
  it("collapses omitted and blank notes to null", () => {
    for (const notes of [undefined, null, "", "   "]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        notes,
        reasonCode: VALID_REASON,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.notes).toBeNull();
    }
  });

  it("returns trimmed notes", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      notes: "  ยี่ห้อเดิม ส่งหลังบ่ายสอง  ",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.notes).toBe("ยี่ห้อเดิม ส่งหลังบ่ายสอง");
  });

  it("rejects notes longer than 1000 characters with the Thai message", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      notes: "ก".repeat(1001),
    });
    expect(r).toEqual({ ok: false, error: "หมายเหตุต้องไม่เกิน 1000 ตัวอักษร" });
  });

  it("accepts notes at exactly 1000 characters", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      notes: "ก".repeat(1000),
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.notes).toHaveLength(1000);
  });

  it("accepts today and future neededBy dates (Bangkok)", () => {
    const today = bangkokToday();
    for (const date of [today, shiftDate(today, 1), shiftDate(today, 30)]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        neededBy: date,
        reasonCode: VALID_REASON,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.neededBy).toBe(date);
    }
  });

  it("rejects a past neededBy date (Bangkok)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      neededBy: shiftDate(bangkokToday(), -1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/วันที่ต้องการรับของ/);
  });

  it("rejects malformed and impossible neededBy dates", () => {
    for (const bad of ["13-06-2026", "2026/06/13", "2026-02-31", "junk"]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        neededBy: bad,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/วันที่ต้องการรับของ/);
    }
  });

  it("normalizes omitted/null/empty neededBy to null", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        neededBy: empty,
        reasonCode: VALID_REASON,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.neededBy).toBeNull();
    }
  });

  it("accepts each declared priority and defaults omitted/null to normal", () => {
    for (const p of PURCHASE_PRIORITIES) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        priority: p,
        reasonCode: VALID_REASON,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.priority).toBe(p);
    }
    const omitted = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(omitted.ok && omitted.value.priority === "normal").toBe(true);
  });

  it("rejects an unknown priority", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      priority: "asap",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ระดับความเร่งด่วน/);
  });

  // Spec 176 U4 — reasonCode is required and must be a declared value.
  it("accepts each declared reason code and echoes it through", () => {
    for (const code of PURCHASE_REASON_CODES) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        reasonCode: code,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.reasonCode).toBe(code);
    }
  });

  it("rejects an omitted or null reason code with the Thai message", () => {
    for (const missing of [undefined, null, ""]) {
      const r = validateCreatePurchaseRequest({
        workPackageId: VALID_WP,
        itemDescription: "Cement",
        quantity: 1,
        unit: "bag",
        reasonCode: missing,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/เหตุผล/);
    }
  });

  it("rejects an unknown reason code", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
      reasonCode: "because",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/เหตุผล/);
  });

  it("trims leading and trailing whitespace on item_description and unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "   Cement   ",
      quantity: 1,
      unit: "  bag  ",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.itemDescription).toBe("Cement");
      expect(r.value.unit).toBe("bag");
    }
  });

  it("preserves internal whitespace in item_description (only trims edges)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "  Cement   bag   50kg  ",
      quantity: 1,
      unit: "bag",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.itemDescription).toBe("Cement   bag   50kg");
  });

  it("rejects an empty item_description", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/วัสดุ/);
  });

  it("rejects whitespace-only item_description (mirrors length(trim(...)) > 0)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "   \t\n  ",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/วัสดุ/);
  });

  it("rejects an empty unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/หน่วย/);
  });

  it("rejects whitespace-only unit", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 1,
      unit: "   ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/หน่วย/);
  });

  it("rejects quantity = 0 (mirrors quantity > 0 CHECK)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: 0,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/จำนวน/);
  });

  it("rejects negative quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: -5,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/จำนวน/);
  });

  it("rejects NaN quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: Number.NaN,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/จำนวน/);
  });

  it("rejects Infinity quantity", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Cement",
      quantity: Number.POSITIVE_INFINITY,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/จำนวน/);
  });

  it("accepts fractional quantity (numeric column, not integer)", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: VALID_WP,
      itemDescription: "Sand",
      quantity: 0.5,
      unit: "tonne",
      reasonCode: VALID_REASON,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quantity).toBe(0.5);
  });

  it("rejects a malformed workPackageId", () => {
    const r = validateCreatePurchaseRequest({
      workPackageId: "not-a-uuid",
      itemDescription: "Cement",
      quantity: 1,
      unit: "bag",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/รายการงาน/);
  });
});

// Spec 208 U4a / ADR 0065 — store-only: a manual PR is always project-scoped
// (store-bound) and catalogued; the generic validator stays lenient (shared) and
// this gate is what createPurchaseRequest applies before inserting (work_package_id
// forced null). Off-catalog or project-less store purchases book nothing → cost
// vanishes, so both are hard-required here.
describe("toStoreBoundPurchase", () => {
  it("accepts a project-scoped, catalogued purchase and echoes the two ids", () => {
    const r = toStoreBoundPurchase({
      projectId: VALID_PROJECT,
      catalogItemId: VALID_CATALOG_ITEM,
    });
    expect(r).toEqual({
      ok: true,
      value: { projectId: VALID_PROJECT, catalogItemId: VALID_CATALOG_ITEM },
    });
  });

  it("rejects a purchase with no project (store-bound requires a project)", () => {
    for (const empty of [null, undefined]) {
      const r = toStoreBoundPurchase({
        projectId: empty as string | null,
        catalogItemId: VALID_CATALOG_ITEM,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/โครงการ/);
    }
  });

  it("rejects an off-catalog purchase (force-catalog under store-only)", () => {
    for (const empty of [null, undefined]) {
      const r = toStoreBoundPurchase({
        projectId: VALID_PROJECT,
        catalogItemId: empty as string | null,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/แคตตาล็อก/);
    }
  });
});

describe("PURCHASE_DECISIONS", () => {
  it("contains exactly the two native decision values", () => {
    expect([...PURCHASE_DECISIONS]).toEqual(["approved", "rejected"]);
  });
});

describe("PURCHASE_PRIORITIES / isPurchasePriority", () => {
  it("pins the enum declaration order (normal < urgent < critical)", () => {
    expect([...PURCHASE_PRIORITIES]).toEqual(["normal", "urgent", "critical"]);
  });

  it("accepts the three declared values and rejects junk", () => {
    expect(isPurchasePriority("normal")).toBe(true);
    expect(isPurchasePriority("urgent")).toBe(true);
    expect(isPurchasePriority("critical")).toBe(true);
    expect(isPurchasePriority("asap")).toBe(false);
    expect(isPurchasePriority("")).toBe(false);
    expect(isPurchasePriority(null)).toBe(false);
    expect(isPurchasePriority(7)).toBe(false);
  });
});

// Spec 176 U4 — the reactive-reason taxonomy (only unplanned_miss dings the PM).
describe("PURCHASE_REASON_CODES / isPurchaseReasonCode", () => {
  it("pins the five locked reason codes in declaration order", () => {
    expect([...PURCHASE_REASON_CODES]).toEqual([
      "unplanned_miss",
      "rework",
      "breakage",
      "scope_change",
      "unforeseeable",
    ]);
  });

  it("accepts the five declared values and rejects junk", () => {
    for (const code of PURCHASE_REASON_CODES) expect(isPurchaseReasonCode(code)).toBe(true);
    expect(isPurchaseReasonCode("planned")).toBe(false);
    expect(isPurchaseReasonCode("")).toBe(false);
    expect(isPurchaseReasonCode(null)).toBe(false);
    expect(isPurchaseReasonCode(3)).toBe(false);
  });
});

describe("isPurchaseDecision", () => {
  it("accepts the two valid decisions", () => {
    expect(isPurchaseDecision("approved")).toBe(true);
    expect(isPurchaseDecision("rejected")).toBe(true);
  });

  it("rejects other lifecycle values (purchased / delivered are AppSheet-only)", () => {
    expect(isPurchaseDecision("purchased")).toBe(false);
    expect(isPurchaseDecision("delivered")).toBe(false);
    expect(isPurchaseDecision("requested")).toBe(false);
  });

  it("rejects junk inputs", () => {
    expect(isPurchaseDecision("")).toBe(false);
    expect(isPurchaseDecision(null)).toBe(false);
    expect(isPurchaseDecision(undefined)).toBe(false);
    expect(isPurchaseDecision(42)).toBe(false);
  });
});

describe("commentRequiredForDecision", () => {
  it("requires a comment only for rejected", () => {
    expect(commentRequiredForDecision("approved")).toBe(false);
    expect(commentRequiredForDecision("rejected")).toBe(true);
  });
});

describe("isDecisionCommentValid", () => {
  it("accepts any comment (including null/empty/whitespace) for approved", () => {
    expect(isDecisionCommentValid("approved", null)).toBe(true);
    expect(isDecisionCommentValid("approved", "")).toBe(true);
    expect(isDecisionCommentValid("approved", "   ")).toBe(true);
    expect(isDecisionCommentValid("approved", "looks good")).toBe(true);
  });

  it("rejects null/empty/whitespace comments for rejected", () => {
    expect(isDecisionCommentValid("rejected", null)).toBe(false);
    expect(isDecisionCommentValid("rejected", "")).toBe(false);
    expect(isDecisionCommentValid("rejected", "   ")).toBe(false);
    expect(isDecisionCommentValid("rejected", "\t\n  ")).toBe(false);
  });

  it("accepts real text for rejected", () => {
    expect(isDecisionCommentValid("rejected", "budget exceeded")).toBe(true);
  });
});

describe("length caps (spec 36 — server-side, client maxLength was the only bound)", () => {
  const base = {
    workPackageId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    itemDescription: "Cement",
    quantity: 1,
    unit: "bag",
    reasonCode: VALID_REASON,
  };

  it("rejects an item description over 500 characters", () => {
    expect(validateCreatePurchaseRequest({ ...base, itemDescription: "x".repeat(501) }).ok).toBe(
      false,
    );
    expect(validateCreatePurchaseRequest({ ...base, itemDescription: "x".repeat(500) }).ok).toBe(
      true,
    );
  });

  it("rejects a unit over 40 characters", () => {
    expect(validateCreatePurchaseRequest({ ...base, unit: "x".repeat(41) }).ok).toBe(false);
    expect(validateCreatePurchaseRequest({ ...base, unit: "x".repeat(40) }).ok).toBe(true);
  });
});
