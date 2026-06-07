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
// After a successful UPDATE the action writes one audit_log row recording
// the decision (P1b, closing the open question on ADR 0022). Mirrors the
// profile_update path — direct INSERT into audit_log under the session
// client, using the new 'purchase_request_decision' enum value. The write
// failure mode mirrors addPhoto's status-transition: console.error and
// continue. The UPDATE is the load-bearing operation; an audit miss is a
// recoverable forensic gap, not a reason to refuse the decision.

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
  if (!user) return { ok: false, error: "Not signed in." };

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
    return { ok: false, error: "Couldn't create the request. Please try again." };
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
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: "Invalid request id." };
  if (!isPurchaseDecision(input.decision)) return { ok: false, error: "Invalid decision." };

  const comment = input.comment ?? null;
  if (!isDecisionCommentValid(input.decision, comment)) {
    return { ok: false, error: "A comment is required when rejecting." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

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
    .select("id, work_package_id");

  if (error) {
    return { ok: false, error: "Couldn't save the decision. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "This request isn't currently in 'requested' state." };
  }

  const updatedRow = data[0]!;

  // Audit the decision — one row per successful approve/reject. Direct
  // INSERT under the session client mirrors the profile_update mechanism
  // (the RPC writes its audit row via the same INSERT shape under the
  // caller's session). A failure here logs and continues — the UPDATE
  // is the load-bearing operation.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "purchase_request_decision",
    target_table: "purchase_requests",
    target_id: input.id,
    payload: {
      work_package_id: updatedRow.work_package_id,
      decision: input.decision,
      decider: user.id,
      comment: normalisedComment,
    },
  });
  if (auditError) {
    console.error("[decidePurchaseRequest] audit_log write failed", {
      purchaseRequestId: input.id,
      decision: input.decision,
      error: auditError.message,
    });
  }

  revalidatePath("/requests");
  revalidatePath("/pm/requests");
  return { ok: true, status: input.decision };
}
