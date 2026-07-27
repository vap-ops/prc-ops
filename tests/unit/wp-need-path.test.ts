// Spec 363 U4 (D5) — "the shelf picks the path".
//
// The SA's state is "I need ปูน". Withdraw-vs-request-vs-self-buy is the firm's
// LEDGER taxonomy, not a question the person on site should have to answer — and
// the app already knows what is on the shelf. So one entry point asks for the
// ITEM, then this decides which action leads.
//
// ซื้อมาเองแล้ว is PERMANENTLY secondary: it records money that has already left
// the company, so its position states the firm's order of preference (store
// first — [[store-first-material-flow-doctrine]]) without ever blocking it.

import { describe, expect, it } from "vitest";

import { decideNeedPath, NEED_PATHS, type NeedPath } from "@/lib/work-packages/need-path";

describe("decideNeedPath (spec 363 D5)", () => {
  it("leads with เบิก when the store holds the item", () => {
    const d = decideNeedPath(12);
    expect(d.primary).toBe("issue");
  });

  it("leads with ขอซื้อ when the shelf is empty", () => {
    const d = decideNeedPath(0);
    expect(d.primary).toBe("request");
  });

  it("treats an unknown on-hand as empty rather than offering a withdrawal", () => {
    // An item the store has never carried has no row at all. Leading with เบิก
    // would send the SA to a form that cannot succeed.
    expect(decideNeedPath(null).primary).toBe("request");
  });

  it("never leads with ซื้อเอง, whatever the shelf says", () => {
    // Money already spent is the path of LAST resort; it must never be the
    // default, or store-first becomes advisory.
    for (const qty of [0, 1, 999, null]) {
      expect(decideNeedPath(qty).primary).not.toBe("self");
    }
  });

  it("always offers ซื้อเอง as a secondary — never blocks it", () => {
    for (const qty of [0, 5, null]) {
      expect(decideNeedPath(qty).secondary).toContain<NeedPath>("self");
    }
  });

  it("offers ขอซื้อ as a secondary when เบิก leads — the shelf may be wrong", () => {
    // On-hand is a ledger figure; the physical shelf can disagree. The SA must be
    // able to request anyway without leaving the sheet.
    expect(decideNeedPath(3).secondary).toEqual<NeedPath[]>(["request", "self"]);
  });

  it("does not offer เบิก at all when there is nothing to withdraw", () => {
    const d = decideNeedPath(0);
    expect(d.primary).not.toBe("issue");
    expect(d.secondary).not.toContain<NeedPath>("issue");
  });

  it("offers every path exactly once, and only known paths", () => {
    for (const qty of [0, 7, null]) {
      const d = decideNeedPath(qty);
      const all = [d.primary, ...d.secondary];
      expect(new Set(all).size).toBe(all.length);
      for (const p of all) expect(NEED_PATHS).toContain(p);
    }
  });

  it("treats a negative on-hand as empty — a ledger can go wrong", () => {
    expect(decideNeedPath(-2).primary).toBe("request");
  });
});

// Spec 363 U4 merge — the three tabs are deleted, so the sheet becomes the ONLY
// door to all three write paths. Plain `procurement` is a read-only WP viewer
// whose single write on that page was the purchase request (isReadOnlyWpViewer /
// role-home.ts; the purchase_requests INSERT policy admits the role
// unconditionally, so this is a real capability, not an accident). The sheet is
// therefore offered to that role too — but per PATH, never whole.
describe("decideNeedPath — restricted callers", () => {
  it("promotes the only permitted path to primary even when the shelf says เบิก", () => {
    // Unrestricted this returns primary=issue. A caller that may only request
    // must not be led to a withdrawal form its role cannot submit.
    const d = decideNeedPath(12, ["request"]);
    expect(d.primary).toBe("request");
    expect(d.secondary).toEqual<NeedPath[]>([]);
  });

  it("offers the same single path when the shelf is empty", () => {
    const d = decideNeedPath(null, ["request"]);
    expect(d.primary).toBe("request");
    expect(d.secondary).toEqual<NeedPath[]>([]);
  });

  it("never widens — a restricted caller is offered NOTHING outside its set", () => {
    for (const qty of [0, 9, null]) {
      for (const allowed of [["request"], ["issue", "request"], ["self"]] as NeedPath[][]) {
        const d = decideNeedPath(qty, allowed);
        for (const p of [d.primary, ...d.secondary]) expect(allowed).toContain(p);
      }
    }
  });

  it("keeps the unrestricted ordering when every path is allowed", () => {
    // The default must not drift away from the two-argument form, or the SA's
    // store-first ordering would depend on which call site ran.
    for (const qty of [0, 9, null]) {
      expect(decideNeedPath(qty, [...NEED_PATHS])).toEqual(decideNeedPath(qty));
    }
  });

  it("still refuses to lead with เบิก when the shelf is empty, however permissive", () => {
    expect(decideNeedPath(0, ["issue", "request"]).primary).toBe("request");
    expect(decideNeedPath(0, ["issue", "request"]).secondary).not.toContain<NeedPath>("issue");
  });
});
