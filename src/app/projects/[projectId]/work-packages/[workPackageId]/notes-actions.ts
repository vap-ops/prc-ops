"use server";

// Spec 71 — work-package notes (backup capture). The note is written via
// the set_work_package_notes SECURITY DEFINER RPC, mirroring
// set_work_package_contractor (spec 31): site_admin is the on-site note
// author but has NO work_packages UPDATE policy, and the RPC writes the
// notes column ONLY — without handing SA every WP column. The action
// validates shape (UUIDs + the 1000-char cap) and relays.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { workPackageHref } from "@/lib/nav/project-paths";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateWorkPackageNotes } from "@/lib/work-packages/validate-notes";

export type SetNotesResult = { ok: true } | { ok: false; error: string };

const ERR_SAVE = "บันทึกหมายเหตุไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setWorkPackageNotes(input: {
  projectId: string;
  workPackageId: string;
  notes: string | null;
}): Promise<SetNotesResult> {
  if (!UUID_REGEX.test(input.projectId) || !UUID_REGEX.test(input.workPackageId)) {
    return { ok: false, error: ERR_SAVE };
  }

  const validated = validateWorkPackageNotes(input.notes);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase } = auth;

  const { data, error } = await supabase.rpc("set_work_package_notes", {
    p_work_package_id: input.workPackageId,
    // Empty string clears the note: the RPC's nullif(btrim(...),'') maps it
    // to null. (typegen types p_notes as a non-null string, so pass "".)
    p_notes: validated.value ?? "",
  });
  if (error || data !== true) {
    if (error?.code === "42501") {
      return { ok: false, error: "ไม่มีสิทธิ์บันทึกหมายเหตุ" };
    }
    return { ok: false, error: ERR_SAVE };
  }

  revalidatePath(workPackageHref(input.projectId, input.workPackageId));
  return { ok: true };
}
