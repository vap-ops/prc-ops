// Writing failing test first.
//
// Spec 396 U4 — the DOOR to the staff-approval queue. `/dashboard` is a Server
// Component vitest cannot render, so the wiring is pinned here by source scan
// (comments stripped FIRST, so prose naming a symbol can never satisfy an
// assertion about USING it) while the count itself is behaviourally tested in
// pending-staff-approvals.test.ts.
//
// What must never regress, and why this file exists:
//
//   AwarenessCard returns null at count<=0. The dashboard's only link to
//   /contacts/bank-changes was a card counting contractor + worker bank changes
//   ONLY. With both at 0 — the live state — the card vanished and the queue had NO
//   DOOR, while 4 identity requests aged to 20 days and the page's last recorded
//   visit was the day BEFORE the oldest was filed. A regression here is silent:
//   nothing errors, a queue simply stops being reachable.
//
// The second invariant is the GATE. The two card families have different audiences
// (live RLS): bank = PM_ROLES, identity/staff_bank = STAFF_APPROVAL_ROLES. The new
// card must key on isStaffApprover, NOT isManager — using isManager would show
// project_manager a count of work they cannot open, and hide it from
// procurement_manager, an actual decider.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE = read("src/app/dashboard/page.tsx");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

// Names BOTH kinds in the destination's own badge vocabulary (bank-changes/page.tsx
// badges identity rows "ข้อมูลตัวตน" and staff-bank rows "พนักงาน"). A card saying only
// "พนักงาน" would head a list whose every live row badges ข้อมูลตัวตน.
const STAFF_LABEL = "การเปลี่ยนข้อมูลตัวตน/บัญชีพนักงานรอการอนุมัติ";
const BANK_LABEL = "การเปลี่ยนบัญชีรอการอนุมัติ";
const QUEUE_HREF = "/contacts/bank-changes";

describe("/dashboard opens a door to the staff-approval queue", () => {
  // >=2 = the import PLUS a real call. A bare toContain is satisfied by the import
  // line alone — the fake-coverage trap this repo keeps re-learning.
  it("reads the pending staff-approval count", () => {
    expect(occurrences(PAGE, "getPendingStaffApprovalCount")).toBe(2);
  });

  // The gate is the half most likely to be "simplified" into the neighbouring
  // isManager. That would be wrong in BOTH directions at once.
  it("gates the staff card on isStaffApprover, never on isManager", () => {
    expect(occurrences(PAGE, "isStaffApprover")).toBe(2);
    // The NEAREST enclosing conditional before the staff label must be the approver
    // gate. Comparing the two openers' positions (rather than scanning a fixed-size
    // window, which reaches back into the bank card and always sees isManager) is
    // what makes swapping the gate red.
    const labelIdx = PAGE.indexOf(STAFF_LABEL);
    expect(labelIdx).toBeGreaterThan(-1);
    const approverIdx = PAGE.lastIndexOf("{isApprover ?", labelIdx);
    const managerIdx = PAGE.lastIndexOf("{isManager ?", labelIdx);
    expect(approverIdx).toBeGreaterThan(managerIdx);
    // …and that gate is the STAFF_APPROVAL_ROLES predicate, not a re-derived literal.
    expect(PAGE).toContain("const isApprover = isStaffApprover(ctx.role)");
  });

  it("renders a SECOND awareness card pointing at the queue", () => {
    expect(occurrences(PAGE, QUEUE_HREF)).toBe(2);
    // >=2, not ==2: this test owns "the staff card exists", not "the dashboard has
    // exactly two awareness cards". A future unrelated third queue card is a
    // legitimate edit and must not red this file. The label + gate-position
    // assertions are what pin THIS card.
    expect(occurrences(PAGE, "<AwarenessCard")).toBeGreaterThanOrEqual(2);
    expect(PAGE).toContain(STAFF_LABEL);
  });

  // The existing bank card must survive UNCHANGED — its label says "บัญชี" (bank),
  // so folding identity rows into its count would make it lie. Separate cards is
  // the whole design; a future "simplification" into one summed count is the
  // regression this pins.
  it("leaves the bank card's own label and count intact", () => {
    expect(PAGE).toContain(BANK_LABEL);
    expect(occurrences(PAGE, "pendingBankChanges")).toBe(2);
    // The staff count must be its own value, never summed into the bank one.
    expect(PAGE).not.toContain("pendingBankChanges + ");
    expect(PAGE).not.toContain("+ pendingStaffApprovals");
  });
});
