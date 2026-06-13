"use server";

// Spec 73 — editable purchase-request note (notes-everywhere rollout). The
// note is written via the set_purchase_request_notes SECURITY DEFINER RPC:
// the request's requester edits their own note, back-office (pm/procurement/
// super) edits any. The authenticated UPDATE grant stays absent (spec 48
// column-scope posture); the RPC is the controlled edit path. The action
// validates shape (UUID + the 1000-char cap) and relays.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateNotes } from "@/lib/notes/validate";

export type SetNotesResult = { ok: true } | { ok: false; error: string };

const ERR_SAVE = "บันทึกหมายเหตุไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setPurchaseRequestNotes(input: {
  requestId: string;
  notes: string;
}): Promise<SetNotesResult> {
  if (!UUID_REGEX.test(input.requestId)) {
    return { ok: false, error: ERR_SAVE };
  }

  const validated = validateNotes(input.notes);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("set_purchase_request_notes", {
    p_id: input.requestId,
    // Empty clears the note (the RPC's nullif(btrim(...),'') maps "" → null).
    p_notes: validated.value ?? "",
  });
  if (error || data !== true) {
    if (error?.code === "42501") {
      return { ok: false, error: "ไม่มีสิทธิ์แก้ไขหมายเหตุ" };
    }
    return { ok: false, error: ERR_SAVE };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${input.requestId}`);
  return { ok: true };
}
