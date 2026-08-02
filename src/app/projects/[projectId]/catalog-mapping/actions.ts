"use server";

// Spec 389 U4 — map a legacy WP to its catalogue work-type. The write goes
// through the SECURITY DEFINER map_wp_to_catalog RPC (PD-tier gate, star
// move/retire, audit row all live in the DB); work_packages has no relevant
// UPDATE grant. requireRole here is defense-in-depth + a fast bounce.
//
// Error copy is honest about retryability (house rule): a role refusal or a
// validation refusal is PERMANENT — telling the user to retry a call that can
// never succeed is the documented honest-copy defect class.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { UUID_REGEX } from "@/lib/validate/uuid";

const GENERIC_ERROR = "บันทึกการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const FORBIDDEN_ERROR = "เฉพาะผู้อำนวยการโครงการเท่านั้นที่จับคู่งานได้";
const INVALID_ERROR =
  "จับคู่ไม่ได้: ประเภทงานไม่ตรงกัน (งานหลัก/งานย่อย) หรือรายการแคตตาล็อกถูกปิดใช้งาน";

export interface MapResult {
  ok: boolean;
  error?: string;
  starsMoved?: number;
  starsRetired?: number;
}

export async function mapWpToCatalog(
  projectId: string,
  workPackageId: string,
  wpCatalogItemId: string | null,
): Promise<MapResult> {
  await requireRole(["project_director", "super_admin"]);

  if (!UUID_REGEX.test(projectId) || !UUID_REGEX.test(workPackageId)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (wpCatalogItemId !== null && !UUID_REGEX.test(wpCatalogItemId)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("map_wp_to_catalog", {
    p_work_package_id: workPackageId,
    ...(wpCatalogItemId !== null ? { p_wp_catalog_item_id: wpCatalogItemId } : {}),
  });

  if (error) {
    console.error("[mapWpToCatalog] rpc failed", { workPackageId, code: error.code });
    // permanent refusals get honest copy — no "retry" on a call that cannot succeed
    if (error.code === "42501") return { ok: false, error: FORBIDDEN_ERROR };
    if (error.code === "22023") return { ok: false, error: INVALID_ERROR };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath(`/projects/${projectId}/catalog-mapping`);
  const payload = (data ?? {}) as { stars_moved?: number; stars_retired?: number };
  return {
    ok: true,
    starsMoved: payload.stars_moved ?? 0,
    starsRetired: payload.stars_retired ?? 0,
  };
}
