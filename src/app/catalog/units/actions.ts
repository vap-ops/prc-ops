"use server";

// Spec 361 U8 — /catalog/units server actions. Every write goes through the
// spec-223 (ADR 0066) SECURITY DEFINER RPCs, which carry the real role gate and
// the code/name validation; `catalog_units` has no INSERT/UPDATE grant and no
// other write path. requireRole(BACK_OFFICE_ROLES) here is defense-in-depth and
// matches the RPC allowlist exactly (project_manager · super_admin ·
// procurement · procurement_manager · project_director, read live 2026-07-26).
//
// The RPCs existed with ZERO callers until this unit — the vocabulary was
// curatable only by SQL.

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import type { UnitClass } from "@/lib/catalog/units-curation";

const GENERIC_ERROR = "บันทึกหน่วยนับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const DUPLICATE_ERROR = "มีหน่วยนับรหัสนี้อยู่แล้ว";
const NOT_FOUND_ERROR = "ไม่พบหน่วยนับนี้";

export type UnitActionResult = { ok: true } | { ok: false; error: string };

interface UnitInput {
  code: string;
  displayName: string;
  /** MUST be sent on every write: update_catalog_unit assigns `abbr_short = v_abbr`
   * unconditionally, so omitting it makes the DEFAULT NULL win and every edit
   * silently wipes the abbreviation. */
  abbrShort: string | null;
  unitClass: UnitClass;
  sortOrder: number;
}

function validate(input: UnitInput): string | null {
  if (input.code.trim() === "" || input.code.length > 40) return "กรอกหน่วย (ไม่เกิน 40 ตัวอักษร)";
  if (input.displayName.trim() === "" || input.displayName.length > 120) {
    return "กรอกชื่อที่แสดง (ไม่เกิน 120 ตัวอักษร)";
  }
  if ((input.abbrShort ?? "").length > 40) return "ตัวย่อยาวเกินไป (ไม่เกิน 40 ตัวอักษร)";
  if (!Number.isInteger(input.sortOrder)) return "ลำดับการแสดงต้องเป็นจำนวนเต็ม";
  return null;
}

// The RPCs raise 22023 for several distinct causes (blank/over-long code, name
// or abbr). validate() above is stricter than every one of them, so a 22023
// reaching here means the unknown-code arm — which is why update/set-active map
// it to NOT_FOUND rather than a field message.
function mapError(code: string | undefined): string {
  if (code === "42501") return "ไม่มีสิทธิ์แก้ไขหน่วยนับ";
  if (code === "23505") return DUPLICATE_ERROR;
  if (code === "22023") return GENERIC_ERROR;
  return GENERIC_ERROR;
}

function revalidate() {
  revalidatePath("/catalog/units");
  // The item form's picker options come from the same table.
  revalidatePath("/catalog");
}

export async function createCatalogUnit(input: UnitInput): Promise<UnitActionResult> {
  await requireRole(BACK_OFFICE_ROLES);
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_catalog_unit", {
    p_code: input.code.trim(),
    p_display_name: input.displayName.trim(),
    ...(input.abbrShort === null ? {} : { p_abbr_short: input.abbrShort }),
    p_unit_class: input.unitClass,
    p_sort_order: input.sortOrder,
  });
  if (error) return { ok: false, error: mapError(error.code) };

  revalidate();
  return { ok: true };
}

export async function updateCatalogUnit(input: UnitInput): Promise<UnitActionResult> {
  await requireRole(BACK_OFFICE_ROLES);
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_catalog_unit", {
    p_code: input.code.trim(),
    p_display_name: input.displayName.trim(),
    ...(input.abbrShort === null ? {} : { p_abbr_short: input.abbrShort }),
    p_unit_class: input.unitClass,
    p_sort_order: input.sortOrder,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, error: NOT_FOUND_ERROR };
    return { ok: false, error: mapError(error.code) };
  }

  revalidate();
  return { ok: true };
}

export async function setCatalogUnitActive(input: {
  code: string;
  isActive: boolean;
}): Promise<UnitActionResult> {
  await requireRole(BACK_OFFICE_ROLES);
  if (input.code.trim() === "") return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_catalog_unit_active", {
    p_code: input.code.trim(),
    p_is_active: input.isActive,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, error: NOT_FOUND_ERROR };
    return { ok: false, error: mapError(error.code) };
  }

  revalidate();
  return { ok: true };
}
