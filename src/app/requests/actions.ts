"use server";

// Purchasing server actions (feature spec 09 / ADR 0022).
//
// createPurchaseRequest: any role that can read work_packages (SA/PM/super)
// requests an item against a WP. The INSERT goes through the session
// (anon-key) client; RLS pins requested_by = auth.uid() and source = 'app'.
//
// decidePurchaseRequest: PM / super approves or rejects. Two-layer
// transition guard mirrors recordDecision (work-package approvals):
//   1. JS predicate validates the decision and the comment-required rule.
//   2. SQL `.eq('id', id).eq('status', 'requested')` clause is the safety
//      net — even if the JS check were broken, the UPDATE only fires
//      against a row that's actually 'requested'.
// 0 rows returned from the UPDATE means the row was already decided (or
// the caller's RLS doesn't see it); both surface as "not in requested state."
//
// Audit logging is NOT done here. The
// `purchase_requests_audit_decision` AFTER UPDATE trigger (migration
// 20260608130100) writes one audit_log row per successful
// requested→approved | rejected transition, atomically inside the same
// transaction as the UPDATE. A decision that fails to audit cannot
// commit — the trigger's exception propagates and rolls back the
// UPDATE. "Exactly one row per decision, never on a non-transition
// update" is therefore a DB invariant, tested in pgTAP 17 section I.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import {
  validateCreatePurchaseRequest,
  isDecisionCommentValid,
  isPurchaseDecision,
  type PurchaseDecision,
} from "@/lib/purchasing/validate-purchase-request";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreatePurchaseRequestInput {
  workPackageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
}

export type CreatePurchaseRequestResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
): Promise<CreatePurchaseRequestResult> {
  const validated = validateCreatePurchaseRequest(input);
  if (!validated.ok) return validated;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("purchase_requests")
    .insert({
      work_package_id: validated.value.workPackageId,
      item_description: validated.value.itemDescription,
      quantity: validated.value.quantity,
      unit: validated.value.unit,
      requested_by: user.id,
      source: "app",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "สร้างคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath("/requests");
  return { ok: true, id: data.id };
}

export interface DecidePurchaseRequestInput {
  id: string;
  decision: PurchaseDecision;
  comment?: string | null;
}

export type DecidePurchaseRequestResult =
  | { ok: true; status: PurchaseDecision }
  | { ok: false; error: string };

export async function decidePurchaseRequest(
  input: DecidePurchaseRequestInput,
): Promise<DecidePurchaseRequestResult> {
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: "รหัสคำขอไม่ถูกต้อง" };
  if (!isPurchaseDecision(input.decision)) return { ok: false, error: "ผลการพิจารณาไม่ถูกต้อง" };

  const comment = input.comment ?? null;
  if (!isDecisionCommentValid(input.decision, comment)) {
    return { ok: false, error: "ต้องใส่ความเห็นเมื่อไม่อนุมัติ" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  // Whitespace-only / null collapses to null. The predicate above already
  // forbids that case for rejected, so this branch only triggers for approved.
  const normalisedComment = comment && comment.trim().length > 0 ? comment.trim() : null;

  const { data, error } = await supabase
    .from("purchase_requests")
    .update({
      status: input.decision,
      approved_by: user.id,
      decided_at: new Date().toISOString(),
      decision_comment: normalisedComment,
    })
    .eq("id", input.id)
    .eq("status", "requested")
    .select("id");

  if (error) {
    return { ok: false, error: "บันทึกผลการพิจารณาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "คำขอนี้ได้รับการพิจารณาไปแล้ว" };
  }

  revalidatePath("/requests");
  revalidatePath("/pm/requests");
  return { ok: true, status: input.decision };
}
