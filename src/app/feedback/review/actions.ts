"use server";

// Spec 193 U3 — triage a feedback report. set_feedback_status is super_admin-only
// (the RPC re-checks the role server-side); this action just narrows the untrusted
// status string and relays. The review list refreshes on success.

import "server-only";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { isFeedbackStatus } from "@/lib/feedback/validate";

export type SetFeedbackStatusResult = { ok: true } | { ok: false; error: string };

const GENERIC = "อัปเดตสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setFeedbackStatus(
  id: string,
  status: string,
): Promise<SetFeedbackStatusResult> {
  if (!isFeedbackStatus(status)) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_feedback_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { ok: false, error: GENERIC };
  return { ok: true };
}
