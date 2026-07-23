"use server";

// Spec 345 U3 — the review actions. The RPCs gate on the AUTHED session's role
// (MONEY_REVIEW_ROLES at the DB), so we call them on requireActionRole().auth
// .supabase, never the admin client (service-role's null role the gate refuses).

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { MONEY_REVIEW_ROLES } from "@/lib/auth/role-home";
import {
  MONEY_SOURCE_TABLES,
  ADMIN_FLAG_TYPES,
  type MoneySourceTable,
} from "@/lib/accounting/review-queue-view";
import type { Database } from "@/lib/db/database.types";

type MoneyFlagTypeDb = Database["public"]["Enums"]["money_flag_type"];

export type ReviewActionResult = { ok: true } | { ok: false; error: string };

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่";
const OPEN_FLAGS_FIRST = "ยังมีธงค้างอยู่ — ปิดธงให้หมดก่อนตรวจผ่าน";

function validSource(source: string): source is MoneySourceTable {
  return (MONEY_SOURCE_TABLES as readonly string[]).includes(source);
}

function voucherPath(source: string, id: string) {
  return `/accounting/review/${source}/${id}`;
}

export async function verifyMoneyEventAction(
  source: string,
  id: string,
  note: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!validSource(source)) return { ok: false, error: GENERIC };
  const { error } = await g.auth.supabase.rpc("verify_money_event", {
    p_source_table: source,
    p_source_id: id,
    ...(note.trim() ? { p_note: note.trim() } : {}),
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("resolve open flags first") ? OPEN_FLAGS_FIRST : GENERIC,
    };
  }
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath(source, id));
  return { ok: true };
}

export async function flagMoneyEventAction(
  source: string,
  id: string,
  flagType: string,
  detail: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!validSource(source)) return { ok: false, error: GENERIC };
  if (!(ADMIN_FLAG_TYPES as readonly string[]).includes(flagType)) {
    return { ok: false, error: GENERIC };
  }
  if (flagType === "other" && !detail.trim()) {
    return { ok: false, error: "กรุณาระบุรายละเอียดสำหรับธง อื่น ๆ" };
  }
  const { error } = await g.auth.supabase.rpc("flag_money_event", {
    p_source_table: source,
    p_source_id: id,
    p_flag_type: flagType as MoneyFlagTypeDb,
    ...(detail.trim() ? { p_detail: detail.trim() } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath(source, id));
  return { ok: true };
}

export async function resolveMoneyFlagAction(
  source: string,
  id: string,
  flagId: string,
  resolution: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!resolution.trim()) return { ok: false, error: "กรุณาระบุผลการแก้ไข" };
  const { error } = await g.auth.supabase.rpc("resolve_money_flag", {
    p_flag_id: flagId,
    p_resolution: resolution.trim(),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath(source, id));
  return { ok: true };
}

export async function dismissMoneyFlagAction(
  source: string,
  id: string,
  flagId: string,
  resolution: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("dismiss_money_flag", {
    p_flag_id: flagId,
    ...(resolution.trim() ? { p_resolution: resolution.trim() } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath(source, id));
  return { ok: true };
}
