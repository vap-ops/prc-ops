// Pure validators for the Purchasing server actions (feature spec 09 /
// ADR 0022). The DB is the security authority — these helpers exist so the
// server action and any future form can share the UX-side rules and so the
// rules are individually testable.
//
// Mirrors `validateDisplayName` in shape (one trim-and-check pass, typed
// result union). The trimmed values are returned in `value` so callers use
// the same string the CHECK constraints see at the DB.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Requester-set urgency (spec 16 addendum A2). Declaration order mirrors
// the DB enum (normal < urgent < critical) — keep them in sync.
export type PurchasePriority = "normal" | "urgent" | "critical";

export const PURCHASE_PRIORITIES: ReadonlyArray<PurchasePriority> = [
  "normal",
  "urgent",
  "critical",
];

export function isPurchasePriority(value: unknown): value is PurchasePriority {
  return typeof value === "string" && (PURCHASE_PRIORITIES as readonly string[]).includes(value);
}

// Today as yyyy-mm-dd in Asia/Bangkok — the validator's one clock
// dependence (spec 16 §2). en-CA gives ISO date formatting.
function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

// Real-calendar check: shape alone admits 2026-02-31 (Date rolls it
// over); the UTC round-trip exposes the rollover.
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type ValidatedPurchaseRequestInput = {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  neededBy: string | null;
  priority: PurchasePriority;
};

export type ValidateCreatePurchaseRequestResult =
  | { ok: true; value: ValidatedPurchaseRequestInput }
  | { ok: false; error: string };

export function validateCreatePurchaseRequest(input: {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  // `| undefined` is explicit for exactOptionalPropertyTypes — callers
  // may pass the property as undefined, not just omit it.
  neededBy?: string | null | undefined;
  priority?: string | null | undefined;
}): ValidateCreatePurchaseRequestResult {
  if (!UUID_REGEX.test(input.workPackageId)) {
    return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };
  }
  const itemDescription = input.itemDescription.trim();
  if (itemDescription.length === 0) {
    return { ok: false, error: "รายการวัสดุต้องไม่ว่าง" };
  }
  // Server-side caps (spec 36): the client maxLength attributes were
  // the only bound — a forged action payload could bloat the site-wide
  // /requests SSR. DB CHECK constraints are a recorded follow-up.
  if (itemDescription.length > 500) {
    return { ok: false, error: "รายการวัสดุต้องไม่เกิน 500 ตัวอักษร" };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: "จำนวนต้องเป็นตัวเลขมากกว่าศูนย์" };
  }
  const unit = input.unit.trim();
  if (unit.length === 0) {
    return { ok: false, error: "หน่วยต้องไม่ว่าง" };
  }
  if (unit.length > 40) {
    return { ok: false, error: "หน่วยต้องไม่เกิน 40 ตัวอักษร" };
  }

  // needed_by is optional (spec 16 §2): blank collapses to null; when
  // present it must be a real yyyy-mm-dd not before today in Bangkok.
  // UX-only — there is deliberately no DB CHECK (ADR 0026).
  const neededByRaw = input.neededBy?.trim() ?? "";
  let neededBy: string | null = null;
  if (neededByRaw.length > 0) {
    if (!isRealIsoDate(neededByRaw)) {
      return { ok: false, error: "วันที่ต้องการรับของไม่ถูกต้อง" };
    }
    if (neededByRaw < bangkokToday()) {
      return { ok: false, error: "วันที่ต้องการรับของต้องไม่เป็นวันที่ผ่านมาแล้ว" };
    }
    neededBy = neededByRaw;
  }

  // priority defaults to normal; anything outside the declared set is
  // rejected (the DB enum is the authority — this mirrors it for UX).
  let priority: PurchasePriority = "normal";
  if (input.priority !== undefined && input.priority !== null) {
    if (!isPurchasePriority(input.priority)) {
      return { ok: false, error: "ระดับความเร่งด่วนไม่ถูกต้อง" };
    }
    priority = input.priority;
  }

  return {
    ok: true,
    value: {
      workPackageId: input.workPackageId,
      itemDescription,
      quantity: input.quantity,
      unit,
      neededBy,
      priority,
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
