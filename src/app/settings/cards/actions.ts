"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";

export interface UpsertCardInput {
  id: string | null;
  label: string;
  holderUserId: string;
  last4: string | null;
}

export type CardActionResult = { ok: true; id: string } | { ok: false; error: string };
export type CardVoidResult = { ok: true } | { ok: false; error: string };

// Create (id=null) or update a company card. super_admin only — enforced by the
// DEFINER RPC; the friendly Thai validation here is a fast pre-check.
export async function upsertCompanyCard(input: UpsertCardInput): Promise<CardActionResult> {
  const label = input.label.trim();
  if (label.length === 0) return { ok: false, error: "กรุณาระบุชื่อบัตร" };
  const last4 = input.last4?.trim() ? input.last4.trim() : null;
  if (last4 !== null && !/^[0-9]{4}$/.test(last4)) {
    return { ok: false, error: "เลข 4 ตัวท้ายต้องเป็นตัวเลข 4 หลัก" };
  }
  if (input.holderUserId.length === 0) return { ok: false, error: "กรุณาเลือกผู้ถือบัตร" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("upsert_company_card", {
    // p_id is nullable at the DB (null = insert), but supabase-js types every
    // uuid arg as a non-null string; the null is honest and the RPC handles it.
    p_id: input.id as string,
    p_label: label,
    p_holder_user_id: input.holderUserId,
    ...(last4 ? { p_last4: last4 } : {}),
  });
  if (error || !data) return { ok: false, error: "บันทึกบัตรไม่สำเร็จ" };

  revalidatePath("/settings/cards");
  return { ok: true, id: data };
}

// Soft-delete a card (is_active=false). super_admin only (RPC-enforced).
export async function deactivateCompanyCard(id: string): Promise<CardVoidResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("deactivate_company_card", { p_id: id });
  if (error) return { ok: false, error: "ปิดใช้งานบัตรไม่สำเร็จ" };

  revalidatePath("/settings/cards");
  return { ok: true };
}
