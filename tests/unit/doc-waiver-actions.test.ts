// Writing failing test first.
//
// Spec 380 U6 — the accounting doc-waiver server actions. The DEFINER RPCs gate
// on the AUTHED session's role ('accounting'/'super_admin' → 42501), which is
// exactly MONEY_REVIEW_ROLES, so the actions call them on
// requireActionRole().auth.supabase — never the admin client, whose null role
// the gate refuses.
//
// The mapping tested here lives in the ACTION, so it is pinned HERE: a component
// test that mocks the action cannot pin copy the action owns (spec 390 lesson).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import {
  waivePurchaseDocsAction,
  unwaivePurchaseDocsAction,
} from "@/app/accounting/review/[source]/[id]/actions";
import { MONEY_REVIEW_ROLES } from "@/lib/auth/role-home";
import { Constants } from "@/lib/db/database.types";

const PR = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireActionRole.mockResolvedValue({ auth: { supabase: { rpc } } });
  rpc.mockResolvedValue({ error: null });
});

describe("waivePurchaseDocsAction (spec 380 U6)", () => {
  it("gates on MONEY_REVIEW_ROLES — the set the DB RPC itself enforces", async () => {
    await waivePurchaseDocsAction(PR, "vendor_refused", "");
    expect(requireActionRole).toHaveBeenCalledWith(MONEY_REVIEW_ROLES, expect.any(String));
  });

  it("passes the reason through and omits an empty note", async () => {
    await waivePurchaseDocsAction(PR, "vendor_refused", "   ");
    expect(rpc).toHaveBeenCalledWith("waive_purchase_docs", {
      p_purchase_request: PR,
      p_reason: "vendor_refused",
    });
  });

  it("trims and sends a real note", async () => {
    await waivePurchaseDocsAction(PR, "other", "  ร้านปิดกิจการ  ");
    expect(rpc).toHaveBeenCalledWith("waive_purchase_docs", {
      p_purchase_request: PR,
      p_reason: "other",
      p_note: "ร้านปิดกิจการ",
    });
  });

  // The RPC raises P0001 for a noteless 'other'. Refusing here keeps the user
  // out of a round-trip AND names the real cause — an honest refusal must say
  // what to do, not "try again" (the honest-copy class).
  it("refuses reason 'other' with no note, naming the cause, without calling the RPC", async () => {
    const r = await waivePurchaseDocsAction(PR, "other", "  ");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("เหตุผล") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a reason outside the enum without calling the RPC", async () => {
    const r = await waivePurchaseDocsAction(PR, "not_a_reason", "x");
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  // A hand-listed `readonly T[]` type-checks with any SUBSET, so it would
  // silently omit the next enum value — which the picker WOULD offer (its labels
  // are a Record over the enum) and this action would then refuse with a generic
  // error. Accept exactly the generated domain, no more and no less.
  it("accepts exactly the enum's own domain", async () => {
    for (const reason of Constants.public.Enums.purchase_doc_waiver_reason) {
      rpc.mockClear();
      const r = await waivePurchaseDocsAction(PR, reason, "note");
      expect(r.ok, `reason ${reason} must be accepted`).toBe(true);
      expect(rpc).toHaveBeenCalled();
    }
  });

  it("surfaces a refusal instead of reporting success", async () => {
    rpc.mockResolvedValue({ error: { message: "role not permitted" } });
    const r = await waivePurchaseDocsAction(PR, "vendor_refused", "");
    expect(r.ok).toBe(false);
  });
});

describe("unwaivePurchaseDocsAction (spec 380 U6)", () => {
  it("gates on MONEY_REVIEW_ROLES and passes the request id", async () => {
    const r = await unwaivePurchaseDocsAction(PR);
    expect(requireActionRole).toHaveBeenCalledWith(MONEY_REVIEW_ROLES, expect.any(String));
    expect(rpc).toHaveBeenCalledWith("unwaive_purchase_docs", { p_purchase_request: PR });
    expect(r.ok).toBe(true);
  });

  it("surfaces a refusal instead of reporting success", async () => {
    rpc.mockResolvedValue({ error: { message: "no waiver to remove" } });
    const r = await unwaivePurchaseDocsAction(PR);
    expect(r.ok).toBe(false);
  });
});
