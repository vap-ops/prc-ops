// Pure validators for the Purchasing server actions (feature spec 09 /
// ADR 0022). The DB is the security authority — these helpers exist so the
// server action and any future form can share the UX-side rules and so the
// rules are individually testable.
//
// Mirrors `validateDisplayName` in shape (one trim-and-check pass, typed
// result union). The trimmed values are returned in `value` so callers use
// the same string the CHECK constraints see at the DB.

import { ISO_DATE_REGEX, bangkokTodayIso } from "@/lib/dates";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isPurchaseReasonCode, type PurchaseReasonCode } from "@/lib/purchasing/reason-code";

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

// Real-calendar check: shape alone admits 2026-02-31 (Date rolls it
// over); the UTC round-trip exposes the rollover.
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type ValidatedPurchaseRequestInput = {
  // Spec 195 P1: the scope. A PR is bound to a project; the work package is
  // OPTIONAL (null = "ทั้งโครงการ / เข้าสโตร์"). When a WP is present the DB
  // derives project_id from it (a BEFORE INSERT trigger), so a WP-bound PR may
  // leave projectId null here; a WP-less PR must carry projectId.
  projectId: string | null;
  workPackageId: string | null;
  itemDescription: string;
  quantity: number;
  unit: string;
  neededBy: string | null;
  priority: PurchasePriority;
  notes: string | null;
  // Spec 176 U4: the reactive-reason tag — required, no default.
  reasonCode: PurchaseReasonCode;
  // Spec 179: optional catalog link (catalog_items.id) — null for an
  // off-catalog free-text request.
  catalogItemId: string | null;
};

export type ValidateCreatePurchaseRequestResult =
  | { ok: true; value: ValidatedPurchaseRequestInput }
  | { ok: false; error: string };

export function validateCreatePurchaseRequest(input: {
  // Spec 195 P1: scope. Both optional individually, but at least one is
  // required — a WP (project derived) OR a project (WP-less / store-bound).
  projectId?: string | null | undefined;
  workPackageId?: string | null | undefined;
  itemDescription: string;
  quantity: number;
  unit: string;
  // `| undefined` is explicit for exactOptionalPropertyTypes — callers
  // may pass the property as undefined, not just omit it.
  neededBy?: string | null | undefined;
  priority?: string | null | undefined;
  notes?: string | null | undefined;
  reasonCode?: string | null | undefined;
  // Spec 179: optional catalog link — uuid when picked, null/blank when the
  // requester free-types an off-catalog item.
  catalogItemId?: string | null | undefined;
}): ValidateCreatePurchaseRequestResult {
  // Spec 195 P1 scope: the work package is optional. A non-blank workPackageId
  // must be a uuid; blank/omitted collapses to null (a project-level request).
  const workPackageRaw = input.workPackageId?.trim() ?? "";
  let workPackageId: string | null = null;
  if (workPackageRaw.length > 0) {
    if (!UUID_REGEX.test(workPackageRaw)) {
      return { ok: false, error: "รหัสรายการงานไม่ถูกต้อง" };
    }
    workPackageId = workPackageRaw;
  }
  // projectId: a non-blank value must be a uuid; blank/omitted collapses to
  // null. Required only when there is no WP (the DB derives project_id from a
  // WP; a WP-less PR has nothing to derive from).
  const projectRaw = input.projectId?.trim() ?? "";
  let projectId: string | null = null;
  if (projectRaw.length > 0) {
    if (!UUID_REGEX.test(projectRaw)) {
      return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
    }
    projectId = projectRaw;
  }
  if (workPackageId === null && projectId === null) {
    return { ok: false, error: "ต้องระบุงานหรือโครงการ" };
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
    if (neededByRaw < bangkokTodayIso()) {
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

  // notes is optional (spec 48): blank collapses to null; server-side
  // 1000-char cap mirrors the item_description posture (spec 36 — DB
  // CHECK is a recorded follow-up).
  const notesRaw = input.notes?.trim() ?? "";
  if (notesRaw.length > 1000) {
    return { ok: false, error: "หมายเหตุต้องไม่เกิน 1000 ตัวอักษร" };
  }
  const notes = notesRaw.length > 0 ? notesRaw : null;

  // reasonCode (spec 176 U4) is required and must be a declared value. Checked
  // LAST so the earlier-field errors above still surface their own message when
  // a caller omits everything. No default — the requester must classify why the
  // request wasn't planned (only `unplanned_miss` scores against the PM in U5).
  if (!isPurchaseReasonCode(input.reasonCode)) {
    return { ok: false, error: "กรุณาเลือกเหตุผลของคำขอซื้อ" };
  }
  const reasonCode = input.reasonCode;

  // catalogItemId (spec 179) is optional: blank/null/omitted collapses to null
  // (an off-catalog free-text request); when present it must be a uuid (the DB
  // FK references catalog_items.id). The DB FK is the authority — this mirrors
  // the shape so the form can reject a forged id before the round-trip.
  const catalogItemRaw = input.catalogItemId?.trim() ?? "";
  let catalogItemId: string | null = null;
  if (catalogItemRaw.length > 0) {
    if (!UUID_REGEX.test(catalogItemRaw)) {
      return { ok: false, error: "รหัสวัสดุในแคตตาล็อกไม่ถูกต้อง" };
    }
    catalogItemId = catalogItemRaw;
  }

  return {
    ok: true,
    value: {
      projectId,
      workPackageId,
      itemDescription,
      quantity: input.quantity,
      unit,
      neededBy,
      priority,
      notes,
      reasonCode,
      catalogItemId,
    },
  };
}

// Spec 208 U4a / ADR 0065 — store-only procurement. Every manual purchase request
// is project-scoped (store-bound, work_package_id NULL) and references a catalog
// item. The generic validateCreatePurchaseRequest stays lenient (it is shared and
// its many field rules are pinned); this gate is the store-only policy the
// createPurchaseRequest action applies before inserting. An off-catalog or
// project-less store purchase books NOTHING at receipt (the receive trigger needs
// a catalog item + WP-less PR) → its cost would vanish, so both are hard-required.
export type StoreBoundPurchase = { projectId: string; catalogItemId: string };

export function toStoreBoundPurchase(input: {
  projectId: string | null;
  catalogItemId: string | null;
}): { ok: true; value: StoreBoundPurchase } | { ok: false; error: string } {
  if (!input.projectId) {
    return { ok: false, error: "ต้องระบุโครงการของคำขอซื้อ" };
  }
  if (!input.catalogItemId) {
    return { ok: false, error: "กรุณาเลือกวัสดุจากแคตตาล็อก (สั่งซื้อเข้าสโตร์)" };
  }
  return { ok: true, value: { projectId: input.projectId, catalogItemId: input.catalogItemId } };
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
