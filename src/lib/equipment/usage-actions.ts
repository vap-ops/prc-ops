"use server";

// Spec 202 U2 + spec 363 U7 / spec 370 — equipment check-out / check-in with the
// evidence contract. Authorization is the DB's: check_out_equipment /
// check_in_equipment are SECURITY DEFINER RPCs that gate on current_user_role()
// (site_admin/pm/procurement/super/director), serialize per item, and snapshot
// daily_rate server-side WHEN PRICED — spec 370 U1 made the rate optional (a
// null rate snapshots null and charges 0). This surface is RATE-FREE: the field
// records spans, never sees money — the log_labor_day posture.
//
// Spec 370 D4: ≥1 condition photo is REQUIRED in BOTH directions, on EVERY door
// — enforced HERE because the RPC cannot see photos, and a door that skips the
// requirement is how the 100%-by-construction acceptance leaks. Failure order:
// photos are uploaded by the CALLER first (storage), then the RPC runs, then
// the photo rows land — a failed RPC leaves orphaned storage objects (fine) but
// never photo rows pretending success; a failed photo-row insert surfaces as an
// error instead of silently dropping evidence. Photo rows always key to the
// ORIGINAL log id — the check-in supersede deliberately does not re-home them.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { UUID_REGEX } from "@/lib/validate/uuid";
import type { Database } from "@/lib/db/database.types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_ERROR = "บันทึกการใช้อุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const PHOTO_REQUIRED = "ต้องถ่ายรูปสภาพอุปกรณ์อย่างน้อย 1 รูป";

export type EquipmentUsageVia = Database["public"]["Enums"]["equipment_usage_via"];

export type EquipmentUsageResult = { ok: true } | { ok: false; error: string };

function checkOutErrorToThai(message: string): string {
  if (message.includes("already checked out")) return "อุปกรณ์นี้ถูกเช็คเอาท์อยู่แล้ว";
  // Spec 202 U3 (F2): the item isn't physically on hand (maintenance/returned/lost).
  if (message.includes("not on site")) return "อุปกรณ์นี้ไม่พร้อมใช้งาน (ซ่อม/คืน/สูญหาย)";
  if (message.includes("complete")) return "งานปิดแล้ว เช็คเอาท์อุปกรณ์ไม่ได้";
  if (message.includes("borrower")) return "ไม่พบรายชื่อผู้ยืมที่เลือก";
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

// The storage policy admits movers only under usage/ at depth 2 — anything else
// was either not uploaded by our flow or is trying to point evidence somewhere
// it could not have been written.
function validPhotoPaths(paths: readonly string[]): boolean {
  return paths.length >= 1 && paths.every((p) => /^usage\/[^/]+\/[^/]+$/.test(p));
}

async function insertPhotoRows(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  logId: string,
  phase: "out" | "in",
  paths: readonly string[],
): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return false;
  const { error } = await supabase.from("equipment_usage_photos").insert(
    paths.map((storage_path) => ({
      log_id: logId,
      phase,
      storage_path,
      taken_by: uid,
    })),
  );
  return !error;
}

export async function checkOutEquipment(input: {
  workPackageId: string;
  itemId: string;
  checkoutDate: string;
  revalidate: string;
  via: EquipmentUsageVia;
  photoPaths: readonly string[];
  borrowerWorkerId?: string;
}): Promise<EquipmentUsageResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.itemId) ||
    !ISO_DATE.test(input.checkoutDate) ||
    !input.revalidate.startsWith("/") ||
    (input.borrowerWorkerId !== undefined && !UUID_REGEX.test(input.borrowerWorkerId))
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!validPhotoPaths(input.photoPaths)) {
    return { ok: false, error: PHOTO_REQUIRED };
  }

  const supabase = await createServerSupabase();
  const { data: logId, error } = await supabase.rpc("check_out_equipment", {
    p_item: input.itemId,
    p_wp: input.workPackageId,
    p_date: input.checkoutDate,
    p_via: input.via,
    ...(input.borrowerWorkerId ? { p_borrower_worker_id: input.borrowerWorkerId } : {}),
  });
  if (error || typeof logId !== "string") {
    if (error?.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์เช็คเอาท์อุปกรณ์" };
    return { ok: false, error: checkOutErrorToThai(error?.message ?? "") };
  }

  if (!(await insertPhotoRows(supabase, logId, "out", input.photoPaths))) {
    // The span opened; the evidence didn't land. Say so — the row detail offers
    // the photos again rather than pretending the record is complete.
    return { ok: false, error: "ยืมสำเร็จ แต่บันทึกรูปไม่สำเร็จ — เปิดรายการแล้วเพิ่มรูปอีกครั้ง" };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}

export async function checkInEquipment(input: {
  logId: string;
  checkinDate: string;
  revalidate: string;
  via: EquipmentUsageVia;
  photoPaths: readonly string[];
}): Promise<EquipmentUsageResult> {
  if (
    !UUID_REGEX.test(input.logId) ||
    !ISO_DATE.test(input.checkinDate) ||
    !input.revalidate.startsWith("/")
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!validPhotoPaths(input.photoPaths)) {
    return { ok: false, error: PHOTO_REQUIRED };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("check_in_equipment", {
    p_log: input.logId,
    p_date: input.checkinDate,
    p_via: input.via,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์คืนอุปกรณ์" };
    return { ok: false, error: checkInErrorToThai(error.message) };
  }

  // Photos key to the ORIGINAL log id — the reader follows the supersede chain.
  if (!(await insertPhotoRows(supabase, input.logId, "in", input.photoPaths))) {
    return { ok: false, error: "คืนสำเร็จ แต่บันทึกรูปไม่สำเร็จ — เพิ่มรูปได้จากรายการอุปกรณ์" };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}
