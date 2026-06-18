"use server";

// Spec 141 U2 — equipment management actions (/equipment, back-office:
// pm/super/procurement). Unlike the worker roster (money → SECURITY DEFINER
// RPCs), equipment's non-money writes go straight through the RLS client:
// U1 granted column-scoped INSERT/UPDATE to authenticated and the back-office
// policies + DB CHECKs are the guard. requireRole here is defense-in-depth and
// gives us the caller id for the created_by pin. The money columns
// (acquisition_cost/acquired_at) have NO grant — never written here.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES, EQUIPMENT_MOVE_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { validateEquipmentItem } from "@/lib/equipment/validate-equipment-item";
import type { Database } from "@/lib/db/database.types";

type EquipmentStatus = Database["public"]["Enums"]["equipment_status"];
type EquipmentMovementKind = Database["public"]["Enums"]["equipment_movement_kind"];

const EQUIPMENT_STATUSES: ReadonlyArray<EquipmentStatus> = [
  "available",
  "on_site",
  "in_use",
  "maintenance",
  "returned",
  "lost",
];

const EQUIPMENT_MOVEMENT_KINDS: ReadonlyArray<EquipmentMovementKind> = [
  "received",
  "deployed",
  "returned",
  "maintenance",
  "lost",
];

const GENERIC_ERROR = "บันทึกอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const MOVE_ERROR = "บันทึกการย้ายอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type EquipmentActionResult = { ok: true } | { ok: false; error: string };

interface EquipmentInput {
  name: string;
  categoryId: string;
  ownerId: string;
  tracking: string;
  assetTag: string;
  quantity: number | null;
  status: string;
}

function validateRefsAndStatus(input: EquipmentInput): EquipmentActionResult {
  if (!UUID_REGEX.test(input.categoryId)) return { ok: false, error: "กรุณาเลือกหมวดหมู่" };
  if (!UUID_REGEX.test(input.ownerId)) return { ok: false, error: "กรุณาเลือกเจ้าของอุปกรณ์" };
  if (!EQUIPMENT_STATUSES.includes(input.status as EquipmentStatus)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true };
}

export async function createEquipment(input: EquipmentInput): Promise<EquipmentActionResult> {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const item = validateEquipmentItem({
    name: input.name,
    tracking: input.tracking,
    quantity: input.quantity,
    assetTag: input.assetTag,
  });
  if (!item.ok) return item;
  const refs = validateRefsAndStatus(input);
  if (!refs.ok) return refs;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("equipment_items").insert({
    name: item.value.name,
    category_id: input.categoryId,
    owner_id: input.ownerId,
    tracking: item.value.tracking,
    asset_tag: item.value.assetTag,
    quantity: item.value.quantity,
    status: input.status as EquipmentStatus,
    created_by: ctx.id,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/equipment");
  return { ok: true };
}

export async function updateEquipment(
  input: EquipmentInput & { id: string },
): Promise<EquipmentActionResult> {
  await requireRole(BACK_OFFICE_ROLES);
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  const item = validateEquipmentItem({
    name: input.name,
    tracking: input.tracking,
    quantity: input.quantity,
    assetTag: input.assetTag,
  });
  if (!item.ok) return item;
  const refs = validateRefsAndStatus(input);
  if (!refs.ok) return refs;

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("equipment_items")
    .update({
      name: item.value.name,
      category_id: input.categoryId,
      owner_id: input.ownerId,
      tracking: item.value.tracking,
      asset_tag: item.value.assetTag,
      quantity: item.value.quantity,
      status: input.status as EquipmentStatus,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/equipment");
  return { ok: true };
}

export async function createEquipmentCategory(input: {
  name: string;
  parentId?: string | null;
}): Promise<EquipmentActionResult> {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return { ok: false, error: "ชื่อหมวดหมู่ต้องไม่เกิน 80 ตัวอักษร" };
  }
  if (input.parentId && !UUID_REGEX.test(input.parentId)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("equipment_categories").insert({
    name,
    parent_id: input.parentId ?? null,
    created_by: ctx.id,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/equipment");
  return { ok: true };
}

export async function createEquipmentOwner(input: {
  name: string;
  phone?: string;
}): Promise<EquipmentActionResult> {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { ok: false, error: "ชื่อเจ้าของต้องไม่เกิน 120 ตัวอักษร" };
  }
  const phone = (input.phone ?? "").trim();
  if (phone.length > 40) return { ok: false, error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("equipment_owners").insert({
    name,
    phone: phone.length === 0 ? null : phone,
    created_by: ctx.id,
  });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/equipment");
  return { ok: true };
}

// Spec 141 U4 — record a movement into the append-only equipment_movements log
// (U3). Goes through the RLS client: U3 granted INSERT(...) to authenticated and
// the staff INSERT policy + the DB CHECKs (project-IFF-deployed, qty≥1) are the
// guard; requireRole is defense-in-depth + gives the created_by id. The
// AFTER-INSERT trigger derives equipment_items.status — not done here. occurred_at
// is omitted so the DB stamps now() (no backdating UI this unit).
export async function recordEquipmentMovement(input: {
  itemId: string;
  kind: string;
  projectId: string | null;
  quantity: number;
  note: string;
}): Promise<EquipmentActionResult> {
  // U5 — the field (site_admin) records movements too; the registry actions
  // above stay BACK_OFFICE_ROLES. Matches the U3 equipment_movements RLS.
  const ctx = await requireRole(EQUIPMENT_MOVE_ROLES);

  if (!UUID_REGEX.test(input.itemId)) return { ok: false, error: MOVE_ERROR };
  if (!EQUIPMENT_MOVEMENT_KINDS.includes(input.kind as EquipmentMovementKind)) {
    return { ok: false, error: MOVE_ERROR };
  }
  const kind = input.kind as EquipmentMovementKind;

  // project_id IFF deployed — mirror the DB CHECK so the failure is friendly.
  if (kind === "deployed") {
    if (!input.projectId || !UUID_REGEX.test(input.projectId)) {
      return { ok: false, error: "กรุณาเลือกโครงการที่จะส่งอุปกรณ์ไป" };
    }
  } else if (input.projectId) {
    return { ok: false, error: MOVE_ERROR };
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, error: "จำนวนที่ย้ายต้องเป็นจำนวนเต็มอย่างน้อย 1" };
  }
  const note = input.note.trim();
  if (note.length > 2000) return { ok: false, error: MOVE_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("equipment_movements").insert({
    item_id: input.itemId,
    kind,
    project_id: kind === "deployed" ? input.projectId : null,
    quantity: input.quantity,
    note: note.length === 0 ? null : note,
    created_by: ctx.id,
  });
  if (error) return { ok: false, error: MOVE_ERROR };

  revalidatePath("/equipment");
  return { ok: true };
}
