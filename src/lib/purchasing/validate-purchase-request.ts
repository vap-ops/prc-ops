// Pure validators for the Purchasing server actions (feature spec 09 /
// ADR 0022). The DB is the security authority — these helpers exist so the
// server action and any future form can share the UX-side rules and so the
// rules are individually testable.
//
// Mirrors `validateDisplayName` in shape (one trim-and-check pass, typed
// result union). The trimmed values are returned in `value` so callers use
// the same string the CHECK constraints see at the DB.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidatedPurchaseRequestInput = {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
};

export type ValidateCreatePurchaseRequestResult =
  | { ok: true; value: ValidatedPurchaseRequestInput }
  | { ok: false; error: string };

export function validateCreatePurchaseRequest(input: {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
}): ValidateCreatePurchaseRequestResult {
  if (!UUID_REGEX.test(input.workPackageId)) {
    return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };
  }
  const itemDescription = input.itemDescription.trim();
  if (itemDescription.length === 0) {
    return { ok: false, error: "รายการวัสดุต้องไม่ว่าง" };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: "จำนวนต้องเป็นตัวเลขมากกว่าศูนย์" };
  }
  const unit = input.unit.trim();
  if (unit.length === 0) {
    return { ok: false, error: "หน่วยต้องไม่ว่าง" };
  }
  return {
    ok: true,
    value: {
      workPackageId: input.workPackageId,
      itemDescription,
      quantity: input.quantity,
      unit,
    },
  };
}

// Decision predicates for the approve / reject action.
//
// The lifecycle has five values but the native decide path only writes two
// of them: 'approved' and 'rejected'. The remaining states ('purchased',
// 'delivered') are written by the AppSheet stage in P2.

export type PurchaseDecision = "approved" | "rejected";

export const PURCHASE_DECISIONS: ReadonlyArray<PurchaseDecision> = ["approved", "rejected"];

export function isPurchaseDecision(value: unknown): value is PurchaseDecision {
  return typeof value === "string" && (PURCHASE_DECISIONS as readonly string[]).includes(value);
}

export function commentRequiredForDecision(decision: PurchaseDecision): boolean {
  return decision === "rejected";
}

// Mirrors the DB `pr_reject_has_comment` CHECK: required-and-non-blank for
// rejection, anything goes for approval.
export function isDecisionCommentValid(
  decision: PurchaseDecision,
  comment: string | null,
): boolean {
  if (!commentRequiredForDecision(decision)) return true;
  if (comment === null) return false;
  return comment.trim().length > 0;
}
