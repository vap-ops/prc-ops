"use server";
// Spec 331 §5 — the super_admin registry editor's write path. Each action relays
// ONE DEFINER RPC keyed by the stable `code` (the surrogate id is never a
// parameter, so a rename can't orphan references). The RPCs gate the caller's
// role themselves, so they run on the AUTHED session's client — the admin client
// would arrive with a null role and 42501.
import { requireActionRole } from "@/lib/auth/action-gate";
import { createClient } from "@/lib/db/server";
import { revalidatePath } from "next/cache";

const SUPER_ONLY = ["super_admin"] as const;
const TYPES_PATH = "/settings/company-doc-types";
const DOCS_PATH = "/settings/company-docs";

type Result = { ok: true } | { ok: false; error: string };

function rpcErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "รหัสนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น";
  if (error.code === "22023") return "ข้อมูลไม่ครบหรือยาวเกินกำหนด";
  if (error.code === "42501") return "ไม่มีสิทธิ์ทำรายการนี้";
  return error.message;
}

async function relay(fn: string, args: Record<string, unknown>): Promise<Result> {
  const gate = await requireActionRole(SUPER_ONLY);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { error } = await gate.auth.supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  revalidatePath(TYPES_PATH);
  revalidatePath(DOCS_PATH);
  return { ok: true };
}

const orNull = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export async function createDocumentCategory(input: {
  code: string;
  nameTh: string;
  nameEn?: string | null;
  sortOrder: number;
}): Promise<Result> {
  return relay("create_company_document_category", {
    p_code: input.code,
    p_name_th: input.nameTh,
    p_name_en: orNull(input.nameEn),
    p_sort_order: input.sortOrder,
  });
}

export async function updateDocumentCategory(input: {
  code: string;
  nameTh: string;
  nameEn?: string | null;
  sortOrder: number;
}): Promise<Result> {
  return relay("update_company_document_category", {
    p_code: input.code,
    p_name_th: input.nameTh,
    p_name_en: orNull(input.nameEn),
    p_sort_order: input.sortOrder,
  });
}

export async function setDocumentCategoryActive(input: {
  code: string;
  isActive: boolean;
}): Promise<Result> {
  return relay("set_company_document_category_active", {
    p_code: input.code,
    p_is_active: input.isActive,
  });
}

interface TypeFields {
  nameTh: string;
  nameEn?: string | null;
  hint: string | null;
  isSingleton: boolean;
  isRequired: boolean;
  requiresExpiry: boolean;
  sortOrder: number;
}

export async function createDocumentType(
  input: TypeFields & { categoryCode: string; code: string },
): Promise<Result> {
  return relay("create_company_document_type", {
    p_category_code: input.categoryCode,
    p_code: input.code,
    p_name_th: input.nameTh,
    p_name_en: orNull(input.nameEn),
    p_hint: orNull(input.hint),
    p_is_singleton: input.isSingleton,
    p_is_required: input.isRequired,
    p_requires_expiry: input.requiresExpiry,
    p_sort_order: input.sortOrder,
  });
}

// NOTE: the RPC's flag parameters all carry defaults, so a PARTIAL call would
// silently reset them. Every caller must send the full set — this action's
// required fields make that a type error rather than a footgun.
export async function updateDocumentType(input: TypeFields & { code: string }): Promise<Result> {
  return relay("update_company_document_type", {
    p_code: input.code,
    p_name_th: input.nameTh,
    p_name_en: orNull(input.nameEn),
    p_hint: orNull(input.hint),
    p_is_singleton: input.isSingleton,
    p_is_required: input.isRequired,
    p_requires_expiry: input.requiresExpiry,
    p_sort_order: input.sortOrder,
  });
}

export async function setDocumentTypeActive(input: {
  code: string;
  isActive: boolean;
}): Promise<Result> {
  return relay("set_company_document_type_active", {
    p_code: input.code,
    p_is_active: input.isActive,
  });
}

// Read for the editor page: the FULL registry including deactivated rows (the
// picker's reader filters them; the editor must show what it can reactivate).
export async function listFullRegistry() {
  const supabase = await createClient();
  const [categories, types] = await Promise.all([
    supabase
      .from("company_document_categories")
      .select("id, code, name_th, sort_order, is_active")
      .order("sort_order", { ascending: true }),
    supabase
      .from("company_document_types")
      .select(
        "id, category_id, code, name_th, hint, is_singleton, is_required, requires_expiry, sort_order, is_active",
      )
      .order("sort_order", { ascending: true }),
  ]);
  return { categories: categories.data ?? [], types: types.data ?? [] };
}
