"use server";

// Spec 175 U2 — add a catalog item. The write goes through the SECURITY DEFINER
// create_catalog_item RPC (role gate + identity-uniqueness live in the DB);
// catalog_items has no INSERT grant. requireRole here is defense-in-depth + a
// fast bounce for non-curators. Edit / deactivate is U3.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];
const CATEGORIES = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
const GENERIC_ERROR = "บันทึกรายการวัสดุไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type CatalogActionResult = { ok: true } | { ok: false; error: string };

export async function createCatalogItem(input: {
  category: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  stockable: boolean;
  note: string;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!CATEGORIES.includes(input.category as ItemCategory)) {
    return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  }
  const baseItem = input.baseItem.trim();
  if (baseItem.length === 0 || baseItem.length > 200) {
    return { ok: false, error: "กรอกชื่อวัสดุ (ไม่เกิน 200 ตัวอักษร)" };
  }
  const unit = input.unit.trim();
  if (unit.length === 0 || unit.length > 40) {
    return { ok: false, error: "เลือกหรือระบุหน่วยนับ" };
  }
  const specAttrs = input.specAttrs.trim();
  if (specAttrs.length > 200) return { ok: false, error: GENERIC_ERROR };
  const note = input.note.trim();
  if (note.length > 1000) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_catalog_item", {
    p_category: input.category as ItemCategory,
    p_base_item: baseItem,
    // Empty → NULL is done in the RPC (nullif(btrim(coalesce(...,'')),'')).
    p_spec_attrs: specAttrs,
    p_unit: unit,
    p_stockable: input.stockable,
    p_note: note,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)" };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มรายการวัสดุ" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateCatalogItem(input: {
  id: string;
  category: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  stockable: boolean;
  note: string;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  if (!CATEGORIES.includes(input.category as ItemCategory)) {
    return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  }
  const baseItem = input.baseItem.trim();
  if (baseItem.length === 0 || baseItem.length > 200) {
    return { ok: false, error: "กรอกชื่อวัสดุ (ไม่เกิน 200 ตัวอักษร)" };
  }
  const unit = input.unit.trim();
  if (unit.length === 0 || unit.length > 40) {
    return { ok: false, error: "เลือกหรือระบุหน่วยนับ" };
  }
  const specAttrs = input.specAttrs.trim();
  if (specAttrs.length > 200) return { ok: false, error: GENERIC_ERROR };
  const note = input.note.trim();
  if (note.length > 1000) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_catalog_item", {
    p_id: input.id,
    p_category: input.category as ItemCategory,
    p_base_item: baseItem,
    // Empty → NULL is done in the RPC.
    p_spec_attrs: specAttrs,
    p_unit: unit,
    p_stockable: input.stockable,
    p_note: note,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)" };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขรายการวัสดุ" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการวัสดุนี้" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

export async function setCatalogItemActive(input: {
  id: string;
  active: boolean;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_catalog_item_active", {
    p_id: input.id,
    p_active: input.active,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการวัสดุนี้" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

export async function setItemSellRate(input: {
  id: string;
  rate: number;
}): Promise<CatalogActionResult> {
  // Spec 178 U5 + follow-up — super_admin / project_director (the exec tier; "PD
  // can also set", operator 2026-06-23). The set_item_sell_rate definer carries the
  // gate; requireRole is defense-in-depth.
  await requireRole(["super_admin", "project_director"]);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  if (!Number.isFinite(input.rate) || input.rate < 0) {
    return { ok: false, error: "กรอกราคาขายเป็นตัวเลข (ไม่ติดลบ)" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_item_sell_rate", {
    p_catalog_item_id: input.id,
    p_sell_rate: input.rate,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการวัสดุนี้" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

export async function setCatalogItemImage(input: {
  id: string;
  path: string | null;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  // The bytes are uploaded client-side first; this records the resulting path
  // (or clears it). Empty → NULL is done in the RPC.
  const path = input.path?.trim() ?? "";
  if (path.length > 300) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_catalog_item_image", {
    p_id: input.id,
    p_image_path: path,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการวัสดุนี้" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}
