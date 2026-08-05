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
import { DOC_WAIVER_NOTE_REQUIRED } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type MoneyFlagTypeDb = Database["public"]["Enums"]["money_flag_type"];
type PurchaseDocWaiverReason = Database["public"]["Enums"]["purchase_doc_waiver_reason"];

// The complete enum domain. Listing it here (rather than trusting the caller)
// keeps an unknown reason out of an audited money decision; a new enum value
// fails its typecheck here instead of reaching the RPC.
const WAIVER_REASONS: readonly PurchaseDocWaiverReason[] = [
  "vendor_refused",
  "docs_unobtainable",
  "other",
];

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

// Spec 380 U6 — the accounting doc waiver (§2 decision ③: accounting-only).
// The DEFINER RPC gates on the AUTHED session's role, which is exactly
// MONEY_REVIEW_ROLES, so these run on the same gate as the review actions.
export async function waivePurchaseDocsAction(
  purchaseRequestId: string,
  reason: string,
  note: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!(WAIVER_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: GENERIC };
  }
  const trimmed = note.trim();
  // The RPC raises P0001 here too; refusing in place names the actual cause
  // rather than spending a round-trip to say "try again".
  if (reason === "other" && !trimmed) {
    return { ok: false, error: DOC_WAIVER_NOTE_REQUIRED };
  }
  const { error } = await g.auth.supabase.rpc("waive_purchase_docs", {
    p_purchase_request: purchaseRequestId,
    p_reason: reason as PurchaseDocWaiverReason,
    ...(trimmed ? { p_note: trimmed } : {}),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath("purchase_requests", purchaseRequestId));
  revalidatePath("/requests/docs");
  return { ok: true };
}

export async function unwaivePurchaseDocsAction(
  purchaseRequestId: string,
): Promise<ReviewActionResult> {
  const g = await requireActionRole(MONEY_REVIEW_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("unwaive_purchase_docs", {
    p_purchase_request: purchaseRequestId,
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/review");
  revalidatePath(voucherPath("purchase_requests", purchaseRequestId));
  revalidatePath("/requests/docs");
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
