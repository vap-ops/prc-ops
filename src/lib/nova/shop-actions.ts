"use server";

// Spec 161 U9 — manage the Nova shop catalog. upsert_shop_item /
// set_shop_item_active (U6a) are SECURITY DEFINER, super_admin only — relayed via
// the RLS server client (the caller's JWT; the admin/service-role client has no
// auth context the gate can read). Validate shape, re-check super, revalidate.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC_ERROR = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type ShopResult = { ok: true } | { ok: false; error: string };

type ActionClient = NonNullable<Awaited<ReturnType<typeof getActionUser>>>["supabase"];

async function requireSuper(): Promise<{ supabase: ActionClient } | { error: string }> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  const { supabase, user } = auth;
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  // Spec 274 U3: honor a super_admin's "view as" — a narrower assumed role is blocked here too.
  const role = await applyAssumedRole(me?.role);
  if (role !== "super_admin") return { error: GENERIC_ERROR };
  return { supabase };
}

export async function upsertShopItem(input: {
  id?: string;
  name: string;
  priceCoins: number;
  description?: string | null;
  sortOrder?: number;
}): Promise<ShopResult> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) return { ok: false, error: "กรุณาระบุชื่อสินค้า" };
  if (!Number.isFinite(input.priceCoins) || input.priceCoins <= 0) {
    return { ok: false, error: "ราคาต้องมากกว่า 0" };
  }
  if (input.id !== undefined && !UUID_REGEX.test(input.id))
    return { ok: false, error: GENERIC_ERROR };

  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };

  // Omit optional args when absent (exactOptionalPropertyTypes — never pass undefined).
  const params: {
    p_name: string;
    p_price_coins: number;
    p_description?: string;
    p_sort_order?: number;
    p_id?: string;
  } = { p_name: name, p_price_coins: input.priceCoins };
  if (input.description != null) params.p_description = input.description;
  if (input.sortOrder != null) params.p_sort_order = input.sortOrder;
  if (input.id != null) params.p_id = input.id;

  const { error } = await gate.supabase.rpc("upsert_shop_item", params);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/nova/shop");
  return { ok: true };
}

export async function setShopItemActive(id: string, active: boolean): Promise<ShopResult> {
  if (!UUID_REGEX.test(id)) return { ok: false, error: GENERIC_ERROR };

  const gate = await requireSuper();
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.supabase.rpc("set_shop_item_active", { p_id: id, p_active: active });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/nova/shop");
  return { ok: true };
}
