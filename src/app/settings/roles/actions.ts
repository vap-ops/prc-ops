"use server";

// Spec 220 / ADR 0050 (G63) — change a user's role. set_user_role is
// super_admin-only (the SECURITY DEFINER RPC re-checks the role + enforces the
// last-super_admin / self-demotion guards); this action narrows the untrusted
// role string and relays, mapping the RPC's guard errors to friendly Thai. The
// role list refreshes on success.

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { isUserRole } from "@/lib/users/validate";

export type SetUserRoleResult = { ok: true } | { ok: false; error: string };

const GENERIC = "เปลี่ยนสิทธิ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

// The RPC raises distinct messages for its guards; surface them as friendly Thai.
function friendly(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("last super_admin")) {
    return "เปลี่ยนไม่ได้ — ต้องมีซูเปอร์แอดมินเหลืออย่างน้อยหนึ่งคน";
  }
  if (m.includes("your own role")) {
    return "เปลี่ยนสิทธิ์ของตัวเองไม่ได้ — ให้ซูเปอร์แอดมินอีกคนเปลี่ยนให้";
  }
  if (m.includes("super_admin only")) return "เฉพาะซูเปอร์แอดมินเท่านั้น";
  if (m.includes("unknown user")) return "ไม่พบผู้ใช้รายนี้";
  return GENERIC;
}

export async function setUserRole(userId: string, role: string): Promise<SetUserRoleResult> {
  if (!isUserRole(role)) return { ok: false, error: GENERIC };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_user_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/settings/roles");
  return { ok: true };
}
