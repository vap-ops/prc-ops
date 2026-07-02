"use server";

// Spec 245 U4 — template-editor actions. Thin template-aware wrappers over the
// SAME write RPCs the plan grid uses (no new RPC): the U1 migration made
// add_supply_plan_lines + remove_supply_plan_line distinguish "unknown plan"
// from "is a template" (FOUND-based checks), so both work against a template.
// The project-scoped supply-plan actions don't fit here — they validate a
// projectId and revalidate the project path; a template has neither.
//
// SAVE always goes through add_supply_plan_lines (the atomic BULK RPC) with
// work_package_id forced null — NEVER the singular add_supply_plan_line, whose
// pre-U1 null-check still misreads a template as "unknown plan" (the U1
// reviewer trap). Role enforcement lives in the SECURITY DEFINER RPCs; this
// maps their error codes for the UI.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type TemplateEditResult = { ok: true } | { ok: false; error: string };

const FAILED = "บันทึกเทมเพลตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NO_PERMISSION = "ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)";

const templateHref = (templateId: string) => `/settings/ordering-templates/${templateId}`;

// Bulk-save the editor's filled rows into the template. Lines carry no WP —
// a template's lines are always whole-project shaped (spec 245 D5), so
// work_package_id is forced null here, not trusted from the client.
export async function bulkAddTemplateLines(input: {
  templateId: string;
  lines: Array<{ catalogItemId: string; qty: number; note: string }>;
}): Promise<TemplateEditResult & { count?: number }> {
  if (!UUID_REGEX.test(input.templateId)) return { ok: false, error: FAILED };
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: "ยังไม่มีรายการที่จะบันทึก" };
  }
  for (const l of input.lines) {
    if (!UUID_REGEX.test(l.catalogItemId)) return { ok: false, error: "เลือกวัสดุให้ครบทุกแถว" };
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      return { ok: false, error: "จำนวนต้องมากกว่า 0 ทุกแถว" };
    }
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data: count, error } = await auth.supabase.rpc("add_supply_plan_lines", {
    p_plan_id: input.templateId,
    p_lines: input.lines.map((l) => ({
      catalog_item_id: l.catalogItemId,
      work_package_id: null,
      qty: l.qty,
      note: l.note,
    })),
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "มีวัสดุซ้ำในเทมเพลต (แก้จำนวนที่รายการเดิมแทน)" };
    }
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(templateHref(input.templateId));
  return { ok: true, count: typeof count === "number" ? count : input.lines.length };
}

// Remove one saved template line (remove_supply_plan_line was template-fixed in U1).
export async function removeTemplateLine(input: {
  templateId: string;
  lineId: string;
}): Promise<TemplateEditResult> {
  if (!UUID_REGEX.test(input.templateId) || !UUID_REGEX.test(input.lineId)) {
    return { ok: false, error: FAILED };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("remove_supply_plan_line", { p_line_id: input.lineId });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "22023") return { ok: false, error: "ไม่พบรายการ" };
    return { ok: false, error: FAILED };
  }

  revalidatePath(templateHref(input.templateId));
  return { ok: true };
}
