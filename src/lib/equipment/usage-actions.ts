"use server";

// Spec 202 U2 — equipment check-out / check-in on the WP page. Authorization is
// the DB's: check_out_equipment / check_in_equipment are SECURITY DEFINER RPCs
// that gate on current_user_role() (site_admin/pm/procurement/super/director),
// serialize per item, and snapshot the (admin-only) daily_rate server-side. This
// surface is RATE-FREE: the field records spans, never sees money — the
// log_labor_day posture. Actions validate shape, relay to the RPC, map errors.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { UUID_REGEX } from "@/lib/validate/uuid";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_ERROR = "บันทึกการใช้อุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type EquipmentUsageResult = { ok: true } | { ok: false; error: string };

function checkOutErrorToThai(message: string): string {
  if (message.includes("already checked out")) return "อุปกรณ์นี้ถูกเช็คเอาท์อยู่แล้ว";
  if (message.includes("daily rate") || message.includes("price it first")) {
    return "อุปกรณ์นี้ยังไม่ได้ตั้งค่าเช่า — ให้ผู้จัดการตั้งราคาก่อน";
  }
  if (message.includes("complete")) return "งานปิดแล้ว เช็คเอาท์อุปกรณ์ไม่ได้";
  if (message.includes("not found")) return "ไม่พบอุปกรณ์หรืองานนี้";
  return GENERIC_ERROR;
}

function checkInErrorToThai(message: string): string {
  if (message.includes("already closed") || message.includes("already superseded")) {
    return "อุปกรณ์นี้ถูกคืนไปแล้ว รีเฟรชหน้าจอ";
  }
  if (message.includes("before check-out")) return "วันที่คืนต้องไม่ก่อนวันเช็คเอาท์";
  return GENERIC_ERROR;
}

export async function checkOutEquipment(input: {
  workPackageId: string;
  itemId: string;
  checkoutDate: string;
  revalidate: string;
}): Promise<EquipmentUsageResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.itemId) ||
    !ISO_DATE.test(input.checkoutDate) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("check_out_equipment", {
    p_item: input.itemId,
    p_wp: input.workPackageId,
    p_date: input.checkoutDate,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เช็คเอาท์อุปกรณ์" };
    return { ok: false, error: checkOutErrorToThai(error.message) };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}

export async function checkInEquipment(input: {
  logId: string;
  checkinDate: string;
  revalidate: string;
}): Promise<EquipmentUsageResult> {
  if (
    !UUID_REGEX.test(input.logId) ||
    !ISO_DATE.test(input.checkinDate) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("check_in_equipment", {
    p_log: input.logId,
    p_date: input.checkinDate,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์คืนอุปกรณ์" };
    return { ok: false, error: checkInErrorToThai(error.message) };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}
