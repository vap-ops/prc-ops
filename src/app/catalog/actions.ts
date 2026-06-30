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
import { isValidProductCode } from "@/lib/catalog/validate";
import { Constants, type Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];
type ItemKind = Database["public"]["Enums"]["catalog_item_kind"];
type FulfillmentMode = Database["public"]["Enums"]["catalog_fulfillment_mode"];
const CATEGORIES = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
// Spec 224 (ADR 0066) — the known facet sets for defense-in-depth validation of
// the (untrusted) server-action input; the RPC also rejects bad enums.
const ITEM_KINDS = new Set<string>(Constants.public.Enums.catalog_item_kind);
const FULFILLMENT_MODES = new Set<string>(Constants.public.Enums.catalog_fulfillment_mode);
const GENERIC_ERROR = "บันทึกรายการวัสดุไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const CODE_FORMAT_ERROR = "รหัสสินค้าต้องเป็นตัวเลข 6 หลัก";
const CODE_DUP_ERROR = "รหัสสินค้านี้ถูกใช้แล้ว";
// Spec 219 — the chosen subcategory must belong to the item's main category (the
// cascading picker enforces it; this is the defence-in-depth message).
const SUBCATEGORY_MISMATCH_ERROR = "หมวดย่อยไม่ตรงกับหมวดหมู่หลัก";
const SUBCATEGORY_GENERIC_ERROR = "บันทึกหมวดย่อยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const SUBCATEGORY_CODE_FORMAT_ERROR = "รหัสหมวดย่อยต้องเป็นตัวเลข 2 หลัก";
const SUBCATEGORY_CODE_DUP_ERROR = "รหัสหมวดย่อยนี้ถูกใช้แล้ว";
const SUBCATEGORY_NAME_ERROR = "กรอกชื่อหมวดย่อย (ไม่เกิน 120 ตัวอักษร)";

export type CatalogActionResult = { ok: true } | { ok: false; error: string };

// A 23505 from these RPCs is either the (base_item, spec_attrs) identity index or
// the product_code unique index — disambiguate on the constraint name in the
// message so the inline error names the right field.
function duplicateMessage(message: string | undefined): string {
  return message?.includes("product_code")
    ? CODE_DUP_ERROR
    : "รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)";
}

export async function createCatalogItem(input: {
  // Spec 221 U3c — the main category is the managed catalog_categories.id.
  categoryId: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  note: string;
  productCode: string;
  // Spec 219 — optional subcategory FK (empty = none). The RPC enforces it
  // belongs to the item's main category.
  subcategoryId: string;
  // Spec 224 (ADR 0066 D3) — the catalog item facets. stockable is DERIVED in the
  // RPC from fulfillmentMode, so it is not sent here.
  kind: ItemKind;
  fulfillmentMode: FulfillmentMode;
  ownerSupplied: boolean;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  const categoryId = input.categoryId.trim();
  if (!UUID_REGEX.test(categoryId)) return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  if (!ITEM_KINDS.has(input.kind) || !FULFILLMENT_MODES.has(input.fulfillmentMode)) {
    return { ok: false, error: GENERIC_ERROR };
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
  const productCode = input.productCode.trim();
  if (!isValidProductCode(productCode)) return { ok: false, error: CODE_FORMAT_ERROR };
  const subcategoryId = input.subcategoryId.trim();
  if (subcategoryId !== "" && !UUID_REGEX.test(subcategoryId)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  // Resolve the legacy enum to write through (kept populated for the 13
  // enum-backed categories so the legacy enum readers keep displaying; null for
  // a user-created category). Unknown id → not a real category.
  const { data: catRow } = await supabase
    .from("catalog_categories")
    .select("legacy_category")
    .eq("id", categoryId)
    .maybeSingle();
  if (!catRow) return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  const legacy = catRow.legacy_category;

  const { error } = await supabase.rpc("create_catalog_item", {
    p_category_id: categoryId,
    p_base_item: baseItem,
    // Empty → NULL is done in the RPC (nullif(btrim(coalesce(...,'')),'')).
    p_spec_attrs: specAttrs,
    p_unit: unit,
    // Spec 208 / ADR 0065: the stockable carve-out is retired — every catalog item
    // routes through the store, so items are always stockable.
    p_stockable: true,
    p_note: note,
    p_product_code: productCode,
    // Spec 224 — the facets. fulfillment_mode is the SSOT; the RPC derives stockable.
    p_kind: input.kind,
    p_fulfillment_mode: input.fulfillmentMode,
    p_owner_supplied: input.ownerSupplied === true,
    ...(legacy ? { p_category: legacy } : {}),
    // Omit the key when empty → the RPC's default null (clears the FK); a uuid
    // sets it. exactOptionalPropertyTypes forbids an explicit undefined here.
    ...(subcategoryId === "" ? {} : { p_subcategory_id: subcategoryId }),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: duplicateMessage(error.message) };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มรายการวัสดุ" };
    // The only 22023 here (inputs are pre-validated above) is the subcategory guard.
    if (error.code === "22023") return { ok: false, error: SUBCATEGORY_MISMATCH_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateCatalogItem(input: {
  id: string;
  // Spec 221 U3c — the managed catalog_categories.id.
  categoryId: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  note: string;
  productCode: string;
  // Spec 219 — optional subcategory FK (empty = none); category-matched by the RPC.
  subcategoryId: string;
  // Spec 224 (ADR 0066 D3) — the catalog item facets (stockable derives from mode).
  kind: ItemKind;
  fulfillmentMode: FulfillmentMode;
  ownerSupplied: boolean;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  const categoryId = input.categoryId.trim();
  if (!UUID_REGEX.test(categoryId)) return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  if (!ITEM_KINDS.has(input.kind) || !FULFILLMENT_MODES.has(input.fulfillmentMode)) {
    return { ok: false, error: GENERIC_ERROR };
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
  const productCode = input.productCode.trim();
  if (!isValidProductCode(productCode)) return { ok: false, error: CODE_FORMAT_ERROR };
  const subcategoryId = input.subcategoryId.trim();
  if (subcategoryId !== "" && !UUID_REGEX.test(subcategoryId)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { data: catRow } = await supabase
    .from("catalog_categories")
    .select("legacy_category")
    .eq("id", categoryId)
    .maybeSingle();
  if (!catRow) return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  const legacy = catRow.legacy_category;

  const { error } = await supabase.rpc("update_catalog_item", {
    p_id: input.id,
    p_category_id: categoryId,
    p_base_item: baseItem,
    // Empty → NULL is done in the RPC.
    p_spec_attrs: specAttrs,
    p_unit: unit,
    p_stockable: true,
    p_note: note,
    p_product_code: productCode,
    // Spec 224 — the facets. fulfillment_mode is the SSOT; the RPC derives stockable.
    p_kind: input.kind,
    p_fulfillment_mode: input.fulfillmentMode,
    p_owner_supplied: input.ownerSupplied === true,
    ...(legacy ? { p_category: legacy } : {}),
    // Omit the key when empty → the RPC's default null (clears the FK); a uuid
    // sets it. exactOptionalPropertyTypes forbids an explicit undefined here.
    ...(subcategoryId === "" ? {} : { p_subcategory_id: subcategoryId }),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: duplicateMessage(error.message) };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขรายการวัสดุ" };
    // 22023 is either the subcategory mismatch or an unknown id — disambiguate on message.
    if (error.code === "22023") {
      return {
        ok: false,
        error: error.message?.includes("subcategory")
          ? SUBCATEGORY_MISMATCH_ERROR
          : "ไม่พบรายการวัสดุนี้",
      };
    }
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

// ---------------------------------------------------------------------------
// Spec 219 U2 — subcategory taxonomy CRUD (back-office). Both go through the
// SECURITY DEFINER create/update_catalog_subcategory RPCs (role gate +
// (category, code) uniqueness live in the DB); catalog_subcategories has no
// write grant. requireRole here is defence-in-depth.
// ---------------------------------------------------------------------------

const SUBCATEGORY_CODE_RE = /^[0-9]{2}$/;

export async function createCatalogSubcategory(input: {
  category: string;
  code: string;
  name: string;
  sortOrder: number;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!CATEGORIES.includes(input.category as ItemCategory)) {
    return { ok: false, error: "กรุณาเลือกหมวดหมู่หลัก" };
  }
  const code = input.code.trim();
  if (!SUBCATEGORY_CODE_RE.test(code)) return { ok: false, error: SUBCATEGORY_CODE_FORMAT_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { ok: false, error: SUBCATEGORY_NAME_ERROR };
  }
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_catalog_subcategory", {
    p_category: input.category as ItemCategory,
    p_code: code,
    p_name: name,
    p_sort_order: sortOrder,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: SUBCATEGORY_CODE_DUP_ERROR };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มหมวดย่อย" };
    return { ok: false, error: SUBCATEGORY_GENERIC_ERROR };
  }

  revalidatePath("/catalog/subcategories");
  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateCatalogSubcategory(input: {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: SUBCATEGORY_GENERIC_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { ok: false, error: SUBCATEGORY_NAME_ERROR };
  }
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_catalog_subcategory", {
    p_id: input.id,
    p_name: name,
    p_sort_order: sortOrder,
    p_is_active: input.isActive,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขหมวดย่อย" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบหมวดย่อยนี้" };
    return { ok: false, error: SUBCATEGORY_GENERIC_ERROR };
  }

  revalidatePath("/catalog/subcategories");
  revalidatePath("/catalog");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Spec 221 U3 — main-category CRUD (back-office). Wraps the U1
// create/update_catalog_category SECURITY DEFINER RPCs. The main-category code
// IS editable (recode) — items key on category_id, not the code.
// ---------------------------------------------------------------------------

const CATEGORY_GENERIC_ERROR = "บันทึกหมวดหลักไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const CATEGORY_CODE_FORMAT_ERROR = "รหัสหมวดหลักต้องเป็นตัวเลข 2 หลัก";
const CATEGORY_CODE_DUP_ERROR = "รหัสหมวดหลักนี้ถูกใช้แล้ว";
const CATEGORY_NAME_ERROR = "กรอกชื่อหมวดหลัก (ไม่เกิน 120 ตัวอักษร)";

export async function createCatalogCategory(input: {
  code: string;
  name: string;
  sortOrder: number;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  const code = input.code.trim();
  if (!SUBCATEGORY_CODE_RE.test(code)) return { ok: false, error: CATEGORY_CODE_FORMAT_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) return { ok: false, error: CATEGORY_NAME_ERROR };
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_catalog_category", {
    p_code: code,
    p_name: name,
    p_sort_order: sortOrder,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: CATEGORY_CODE_DUP_ERROR };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เพิ่มหมวดหลัก" };
    return { ok: false, error: CATEGORY_GENERIC_ERROR };
  }

  revalidatePath("/catalog/subcategories");
  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateCatalogCategory(input: {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}): Promise<CatalogActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: CATEGORY_GENERIC_ERROR };
  const code = input.code.trim();
  if (!SUBCATEGORY_CODE_RE.test(code)) return { ok: false, error: CATEGORY_CODE_FORMAT_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) return { ok: false, error: CATEGORY_NAME_ERROR };
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_catalog_category", {
    p_id: input.id,
    p_code: code,
    p_name: name,
    p_sort_order: sortOrder,
    p_is_active: input.isActive,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: CATEGORY_CODE_DUP_ERROR };
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขหมวดหลัก" };
    if (error.code === "22023") return { ok: false, error: "ไม่พบหมวดหลักนี้" };
    return { ok: false, error: CATEGORY_GENERIC_ERROR };
  }

  revalidatePath("/catalog/subcategories");
  revalidatePath("/catalog");
  return { ok: true };
}
