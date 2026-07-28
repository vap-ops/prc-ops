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
import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
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

// Runtime allowlist for the door tag — `via` is client input like everything
// else here; a bad value must fail HERE, not surface as a 22P02 GENERIC_ERROR.
const VIA_VALUES: readonly EquipmentUsageVia[] = ["scan", "search", "wp_tab", "store"];

const MAX_PHOTOS = 6;

// The storage policy admits movers only under usage/ at depth 2 — anything else
// was either not uploaded by our flow or is trying to point evidence somewhere
// it could not have been written. Capped: one call must not insert an unbounded
// row batch.
function validPhotoPaths(paths: readonly string[]): boolean {
  return (
    paths.length >= 1 &&
    paths.length <= MAX_PHOTOS &&
    paths.every((p) => /^usage\/[^/]+\/[^/]+$/.test(p))
  );
}

// D4's evidence gate is only as strong as the paths being REAL uploads — a
// well-shaped string with no object behind it would satisfy the regex with zero
// photos taken (fresh-eyes 🟡9a). Verify existence against storage before the
// RPC. (What this deliberately does NOT try to stop: a caller re-submitting a
// genuinely-uploaded file as different-phase evidence — D4 protects against
// omission, not an SA actively forging their own record; noted in spec 370.)
async function photosExistInStorage(paths: readonly string[]): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("equipment-images")
    .createSignedUrls([...paths], 60);
  if (error || !data || data.length !== paths.length) return false;
  return data.every((d) => !d.error && d.signedUrl);
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
    !VIA_VALUES.includes(input.via) ||
    (input.borrowerWorkerId !== undefined && !UUID_REGEX.test(input.borrowerWorkerId))
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!validPhotoPaths(input.photoPaths)) {
    return { ok: false, error: PHOTO_REQUIRED };
  }
  if (!(await photosExistInStorage(input.photoPaths))) {
    return { ok: false, error: PHOTO_REQUIRED };
  }

  const supabase = await createServerSupabase();
  // Spec 370 §3 U2 (F7): bulk items are refused AT THIS LAYER — the RPC has no
  // tracking guard, and a server action is a public endpoint, so a raw call
  // with a bulk uuid must not sail through. (Middle-layer-refuses-what-the-
  // RPC-allows is the recorded v1 scope-hold.)
  const { data: itemRow } = await supabase
    .from("equipment_items")
    .select("tracking")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!itemRow) return { ok: false, error: "ไม่พบอุปกรณ์หรืองานนี้" };
  if (itemRow.tracking === "bulk") {
    return { ok: false, error: "ของแบบนับจำนวน (เช่น นั่งร้าน) ยังยืมรายชิ้นไม่ได้" };
  }
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
    // The span opened; the evidence rows didn't land. Honest about BOTH facts
    // — no add-photo-later door exists yet (spec 370 open question), so the
    // message must not point at one. The caller refreshes on this path so the
    // list shows the opened span.
    revalidatePath(input.revalidate);
    return { ok: false, error: "บันทึกยืมแล้ว แต่แนบรูปไม่สำเร็จ — รายการนี้จะไม่มีรูปสภาพ" };
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
    !input.revalidate.startsWith("/") ||
    !VIA_VALUES.includes(input.via)
  ) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!validPhotoPaths(input.photoPaths)) {
    return { ok: false, error: PHOTO_REQUIRED };
  }
  if (!(await photosExistInStorage(input.photoPaths))) {
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
    revalidatePath(input.revalidate);
    return { ok: false, error: "บันทึกคืนแล้ว แต่แนบรูปไม่สำเร็จ — รายการนี้จะไม่มีรูปสภาพตอนคืน" };
  }

  revalidatePath(input.revalidate);
  return { ok: true };
}

export type LoanPhotoUrlsResult = { ok: true; urls: string[] } | { ok: false };

/**
 * Borrow-time (`out`) photo URLs for one loan, minted ON DEMAND — page-render
 * signed URLs are dead (120s TTL) before a คืน sheet opens. Authorization is
 * the photo table's staff-only SELECT policy: the RLS read below returns rows
 * only for roles the policy admits, and the admin client then merely signs the
 * paths that read already authorized.
 */
export async function fetchLoanPhotoUrls(logId: string): Promise<LoanPhotoUrlsResult> {
  if (!UUID_REGEX.test(logId)) return { ok: false };
  const supabase = await createServerSupabase();
  const { data: rows, error } = await supabase
    .from("equipment_usage_photos")
    .select("id, storage_path")
    .eq("log_id", logId)
    .eq("phase", "out")
    .limit(MAX_PHOTOS);
  if (error) return { ok: false };
  const urls = await mintSignedUrls("equipment-images", rows ?? []);
  return {
    ok: true,
    urls: (rows ?? []).map((r) => urls.get(r.id)).filter((u): u is string => !!u),
  };
}
