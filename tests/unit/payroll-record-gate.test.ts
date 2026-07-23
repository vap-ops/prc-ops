// Writing failing test first.
//
// Record-payment gate parity (specs 187/261/252, ADR 0070). The /payroll page
// renders the record affordance (RecordPaymentSheet) to PAYROLL_ROLES —
// PM set + procurement + procurement_manager (page.tsx: canRecord). The live
// record_wage_payment RPC gates on is_back_office(), which spec 261 U1b widened
// to that SAME set. But the server action recordWagePayment kept spec 127's bare
// PM_ROLES gate — so procurement AND procurement_manager saw the button and were
// refused on click (affordance-then-refuse), the exact sibling of the payroll CSV
// export-gate bug (payroll-export-gate.test.ts). All three surfaces must gate on
// the one set the affordance is shown to.
//
// Behavioural pin (not a source-scan): drive each role through the real gate.
// Mutation-check: revert the action to PM_ROLES → procurement + procurement_manager
// red here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAYROLL_ROLES, PAYROLL_VIEW_ROLES } from "@/lib/auth/role-home";

const { getActionUser, applyAssumedRole, rpc, revalidatePath } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  applyAssumedRole: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/action-gate", () => ({ getActionUser, NOT_SIGNED_IN: "not signed in" }));
vi.mock("@/lib/auth/apply-assumed-role", () => ({ applyAssumedRole }));

import { recordWagePayment } from "@/lib/labor/actions";

// A shape that clears validateWagePayment so control reaches the role gate.
const VALID = {
  workerId: "11111111-1111-4111-8111-111111111111",
  from: "2026-07-01",
  to: "2026-07-31",
  paidAt: "2026-07-31",
  paidAmount: 1000,
  method: "bank_transfer",
  reference: "",
  note: "",
  revalidate: "/payroll",
};

// The action's own authority refusal (labor/actions.ts).
const REFUSAL = "เฉพาะผู้จัดการโครงการเท่านั้นที่บันทึกการจ่ายเงินได้";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  revalidatePath.mockReset();
  getActionUser.mockReset().mockResolvedValue({
    // applyAssumedRole is mocked to return the role under test directly, so the
    // users read is a placeholder — only its await-ability matters.
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { role: "placeholder" } }) }),
        }),
      }),
      rpc,
    },
    user: { id: "u1" },
  });
  applyAssumedRole.mockReset();
});

describe("recordWagePayment gate parity — admits exactly the PAYROLL_ROLES affordance set", () => {
  for (const role of PAYROLL_ROLES) {
    it(`admits ${role} (the set /payroll renders the record affordance to)`, async () => {
      applyAssumedRole.mockResolvedValue(role);
      const r = await recordWagePayment(VALID);
      expect(r).toEqual({ ok: true });
      expect(rpc).toHaveBeenCalledWith(
        "record_wage_payment",
        expect.objectContaining({ p_worker: VALID.workerId }),
      );
    });
  }
});

describe("recordWagePayment gate — refuses roles outside the affordance set", () => {
  // accounting is admitted to VIEW payroll (PAYROLL_VIEW_ROLES, spec 252) but must
  // NEVER record — guards against widening the action to the view set by mistake.
  for (const role of ["accounting", "site_admin", "visitor"]) {
    it(`refuses ${role} with the payroll-authority error and never calls the RPC`, async () => {
      applyAssumedRole.mockResolvedValue(role);
      const r = await recordWagePayment(VALID);
      expect(r).toEqual({ ok: false, error: REFUSAL });
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("accounting is a viewer, not a payer (parity guard is meaningful)", () => {
    // If these two sets ever coincide, the negative above is vacuous.
    expect(PAYROLL_VIEW_ROLES).toContain("accounting");
    expect(PAYROLL_ROLES).not.toContain("accounting");
  });
});

describe("recordWagePayment gate parity — the affordance is keyed to the same set", () => {
  it("the /payroll page shows the record affordance to PAYROLL_ROLES (matches the action)", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "payroll", "page.tsx"), "utf8");
    expect(page).toContain("PAYROLL_ROLES.includes(ctx.role)");
  });
});
