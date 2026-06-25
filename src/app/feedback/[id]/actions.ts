"use server";

// Spec 201 U2 — post an operator reply onto a feedback thread. post_feedback_message
// is super_admin-only (the RPC re-checks the role server-side); this action narrows
// the body and relays. The thread refreshes on success.

import "server-only";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";

export type PostFeedbackMessageResult = { ok: true; id: string } | { ok: false; error: string };
export type DraftActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const GENERIC_DRAFT = "ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function postFeedbackMessage(
  feedbackId: string,
  body: string,
): Promise<PostFeedbackMessageResult> {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 4000) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("post_feedback_message", {
    p_feedback_id: feedbackId,
    p_body: trimmed,
  });
  if (error || !data) return { ok: false, error: GENERIC };
  return { ok: true, id: data };
}

// Spec 201 U4 — the operator's approval gate. publish_feedback_draft and
// discard_feedback_draft are super_admin-only (the RPC re-checks the role); these
// actions relay. The thread + draft list refresh on success.
export async function publishFeedbackDraft(draftId: string): Promise<DraftActionResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("publish_feedback_draft", { p_draft_id: draftId });
  if (error) return { ok: false, error: GENERIC_DRAFT };
  return { ok: true };
}

export async function discardFeedbackDraft(draftId: string): Promise<DraftActionResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("discard_feedback_draft", { p_draft_id: draftId });
  if (error) return { ok: false, error: GENERIC_DRAFT };
  return { ok: true };
}
