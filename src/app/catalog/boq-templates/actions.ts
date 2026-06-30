"use server";

// Spec 237 (ADR 0066 / S10-U2) — the BOQ template + line authoring actions. Each
// write goes through a spec-236 SECURITY DEFINER RPC (role gate + FK existence +
// uniqueness live in the DB); boq_template / boq_line have no write grant.
// requireRole here is defense-in-depth + a fast bounce for non-curators. The
// optional uuid/text args are OMITTED when empty (the spread pattern) so the
// RPC's default null applies — exactOptionalPropertyTypes forbids an explicit
// undefined. Mirrors src/app/catalog/actions.ts (createCatalogItem).

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { Constants, type Database } from "@/lib/db/database.types";

type VariationType = Database["public"]["Enums"]["boq_variation_type"];
const VARIATION_TYPES = new Set<string>(Constants.public.Enums.boq_variation_type);

const TEMPLATE_GENERIC_ERROR = "บันทึกแม่แบบ BOQ ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const TEMPLATE_CODE_DUP_ERROR = "รหัสแม่แบบนี้ถูกใช้แล้ว";
const TEMPLATE_CODE_ERROR = "กรอกรหัสแม่แบบ (ไม่เกิน 40 ตัวอักษร)";
const TEMPLATE_NAME_ERROR = "กรอกชื่อแม่แบบ (ไม่เกิน 200 ตัวอักษร)";
const TEMPLATE_NOT_FOUND_ERROR = "ไม่พบแม่แบบนี้";
const LINE_GENERIC_ERROR = "บันทึกรายการ BOQ ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const LINE_DESCRIPTION_ERROR = "กรอกรายละเอียดรายการ (ไม่เกิน 500 ตัวอักษร)";
const LINE_QTY_ERROR = "กรอกจำนวนเป็นตัวเลขมากกว่า 0";
const LINE_UNIT_ERROR = "เลือกหรือระบุหน่วยนับ";
const LINE_RATE_ERROR = "กรอกราคาเป็นตัวเลข (ไม่ติดลบ)";
const LINE_NOT_FOUND_ERROR = "ไม่พบรายการนี้";
const NOT_PERMITTED_ERROR = "ไม่มีสิทธิ์ทำรายการนี้";

export type BoqActionResult = { ok: true } | { ok: false; error: string };

export async function createBoqTemplate(input: {
  code: string;
  name: string;
  description: string;
}): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  const code = input.code.trim();
  if (code.length === 0 || code.length > 40) return { ok: false, error: TEMPLATE_CODE_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) return { ok: false, error: TEMPLATE_NAME_ERROR };
  const description = input.description.trim();

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_boq_template", {
    p_code: code,
    p_name: name,
    ...(description === "" ? {} : { p_description: description }),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: TEMPLATE_CODE_DUP_ERROR };
    if (error.code === "42501") return { ok: false, error: NOT_PERMITTED_ERROR };
    return { ok: false, error: TEMPLATE_GENERIC_ERROR };
  }

  revalidatePath("/catalog/boq-templates");
  return { ok: true };
}

export async function updateBoqTemplate(input: {
  id: string;
  name: string;
  description: string;
}): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: TEMPLATE_GENERIC_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) return { ok: false, error: TEMPLATE_NAME_ERROR };
  const description = input.description.trim();

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_boq_template", {
    p_id: input.id,
    p_name: name,
    ...(description === "" ? {} : { p_description: description }),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NOT_PERMITTED_ERROR };
    if (error.code === "22023") return { ok: false, error: TEMPLATE_NOT_FOUND_ERROR };
    return { ok: false, error: TEMPLATE_GENERIC_ERROR };
  }

  revalidatePath("/catalog/boq-templates");
  revalidatePath(`/catalog/boq-templates/${input.id}`);
  return { ok: true };
}

export async function setBoqTemplateActive(input: {
  id: string;
  isActive: boolean;
}): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: TEMPLATE_GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_boq_template_active", {
    p_id: input.id,
    p_is_active: input.isActive,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NOT_PERMITTED_ERROR };
    if (error.code === "22023") return { ok: false, error: TEMPLATE_NOT_FOUND_ERROR };
    return { ok: false, error: TEMPLATE_GENERIC_ERROR };
  }

  revalidatePath("/catalog/boq-templates");
  revalidatePath(`/catalog/boq-templates/${input.id}`);
  return { ok: true };
}

// The shared line fields the add/edit forms submit; the actions validate + map
// the same way (only the id vs template-id key differs).
interface BoqLineInput {
  description: string;
  qty: number;
  unit: string;
  catalogItemId: string;
  workCategoryId: string;
  materialRate: number;
  laborRate: number;
  isStandard: boolean;
  variationType: string;
  exclusivityGroup: string;
}

// Validate the shared line fields → the trimmed, typed values to spread into the
// RPC args (optional uuid/text args omitted when empty), or an error string.
function validateLine(input: BoqLineInput):
  | { ok: false; error: string }
  | {
      ok: true;
      values: {
        p_description: string;
        p_qty: number;
        p_unit: string;
        p_material_rate: number;
        p_labor_rate: number;
        p_is_standard: boolean;
        p_variation_type: VariationType;
      } & Partial<{
        p_catalog_item_id: string;
        p_work_category_id: string;
        p_exclusivity_group: string;
      }>;
    } {
  const description = input.description.trim();
  if (description.length === 0 || description.length > 500) {
    return { ok: false, error: LINE_DESCRIPTION_ERROR };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: LINE_QTY_ERROR };
  const unit = input.unit.trim();
  if (unit.length === 0 || unit.length > 40) return { ok: false, error: LINE_UNIT_ERROR };
  if (!Number.isFinite(input.materialRate) || input.materialRate < 0) {
    return { ok: false, error: LINE_RATE_ERROR };
  }
  if (!Number.isFinite(input.laborRate) || input.laborRate < 0) {
    return { ok: false, error: LINE_RATE_ERROR };
  }
  if (!VARIATION_TYPES.has(input.variationType)) return { ok: false, error: LINE_GENERIC_ERROR };
  const catalogItemId = input.catalogItemId.trim();
  if (catalogItemId !== "" && !UUID_REGEX.test(catalogItemId)) {
    return { ok: false, error: LINE_GENERIC_ERROR };
  }
  const workCategoryId = input.workCategoryId.trim();
  if (workCategoryId !== "" && !UUID_REGEX.test(workCategoryId)) {
    return { ok: false, error: LINE_GENERIC_ERROR };
  }
  const exclusivityGroup = input.exclusivityGroup.trim();
  if (exclusivityGroup.length > 100) return { ok: false, error: LINE_GENERIC_ERROR };

  return {
    ok: true,
    values: {
      p_description: description,
      p_qty: input.qty,
      p_unit: unit,
      p_material_rate: input.materialRate,
      p_labor_rate: input.laborRate,
      p_is_standard: input.isStandard === true,
      p_variation_type: input.variationType as VariationType,
      ...(catalogItemId === "" ? {} : { p_catalog_item_id: catalogItemId }),
      ...(workCategoryId === "" ? {} : { p_work_category_id: workCategoryId }),
      ...(exclusivityGroup === "" ? {} : { p_exclusivity_group: exclusivityGroup }),
    },
  };
}

function mapLineError(code: string | undefined): string {
  if (code === "42501") return NOT_PERMITTED_ERROR;
  if (code === "22023") return LINE_NOT_FOUND_ERROR;
  return LINE_GENERIC_ERROR;
}

export async function addBoqLine(
  input: BoqLineInput & { boqTemplateId: string },
): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.boqTemplateId)) return { ok: false, error: LINE_GENERIC_ERROR };
  const v = validateLine(input);
  if (!v.ok) return v;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("add_boq_line", {
    p_boq_template_id: input.boqTemplateId,
    ...v.values,
  });
  if (error) return { ok: false, error: mapLineError(error.code) };

  revalidatePath(`/catalog/boq-templates/${input.boqTemplateId}`);
  return { ok: true };
}

export async function updateBoqLine(
  input: BoqLineInput & { id: string; boqTemplateId?: string },
): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: LINE_GENERIC_ERROR };
  const v = validateLine(input);
  if (!v.ok) return v;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("update_boq_line", {
    p_id: input.id,
    ...v.values,
  });
  if (error) return { ok: false, error: mapLineError(error.code) };

  if (input.boqTemplateId && UUID_REGEX.test(input.boqTemplateId)) {
    revalidatePath(`/catalog/boq-templates/${input.boqTemplateId}`);
  }
  return { ok: true };
}

export async function removeBoqLine(input: {
  id: string;
  boqTemplateId?: string;
}): Promise<BoqActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: LINE_GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("remove_boq_line", { p_id: input.id });
  if (error) return { ok: false, error: mapLineError(error.code) };

  if (input.boqTemplateId && UUID_REGEX.test(input.boqTemplateId)) {
    revalidatePath(`/catalog/boq-templates/${input.boqTemplateId}`);
  }
  return { ok: true };
}
