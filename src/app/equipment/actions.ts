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
import { validateEquipmentDailyRate } from "@/lib/equipment/validate-equipment-daily-rate";
import { parseEquipmentImport } from "@/lib/equipment/equipment-import";
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
    // Spec 275: owners are id-mirrored into suppliers — dual-write keeps the
    // supplier edge (GL party, 274 invariant) in step. Fix 2026-07-14.
    supplier_id: input.ownerId,
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
      // Spec 275 dual-write (see createEquipment).
      supplier_id: input.ownerId,
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

// Spec 361 U6 — rename a category. The list has been add-only since spec 141,
// so a typo was permanent. No migration needed: the live
// `equipment_categories update by back office` policy admits the same five
// roles as the insert, and `authenticated` holds a column-scoped UPDATE grant
// on exactly (name, parent_id) — so this UPDATE is the widest write the grant
// permits, and requireRole here mirrors the policy.
export async function renameEquipmentCategory(input: {
  id: string;
  name: string;
}): Promise<EquipmentActionResult> {
  await requireRole(BACK_OFFICE_ROLES);
  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return { ok: false, error: "ชื่อหมวดหมู่ต้องไม่เกิน 80 ตัวอักษร" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("equipment_categories").update({ name }).eq("id", input.id);
  // The policy refuses with 42501; RLS hiding the row surfaces as zero rows
  // updated, which PostgREST reports without an error — both read as "no".
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขหมวดหมู่" };
    if (error.code === "23505") return { ok: false, error: "มีหมวดหมู่ชื่อนี้อยู่แล้ว" };
    return { ok: false, error: GENERIC_ERROR };
  }

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

// Spec 202 U1 — set the per-item equipment daily charge-out rate (MONEY). Goes
// through the SECURITY DEFINER set_equipment_daily_rate RPC (the real gate +
// audit live in the DB; daily_rate has NO authenticated grant, so this is the
// only write path). requireRole(BACK_OFFICE_ROLES) is defense-in-depth and matches
// the RPC's final gate (pm/super/procurement/project_director, 20260751000000).
// Mirrors setItemSellRate; the RPC raises P0001 for both not-found and a bad rate.
export async function setEquipmentDailyRate(input: {
  id: string;
  rate: number;
}): Promise<EquipmentActionResult> {
  await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.id)) return { ok: false, error: GENERIC_ERROR };
  const rate = validateEquipmentDailyRate(input.rate);
  if (!rate.ok) return rate;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_equipment_daily_rate", {
    p_id: input.id,
    p_rate: rate.value,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์ตั้งค่าเช่าอุปกรณ์" };
    if (error.code === "P0001")
      return { ok: false, error: "ไม่พบอุปกรณ์นี้ หรือค่าเช่าไม่ถูกต้อง" };
    return { ok: false, error: GENERIC_ERROR };
  }

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

// ---------------------------------------------------------------------------
// Spec 367 U3b — bulk import from the U2 export's own CSV.
//
// Gate is BACK_OFFICE_ROLES: the same audience that may INSERT/UPDATE
// equipment_items through the row forms, so the file can do nothing a hand edit
// could not. requireRole also gives the caller id for the created_by pin the
// INSERT policy enforces.
//
// The parse layer refuses money, an unknown id, unknown taxonomy and a ผู้ขาย
// that drifts from เจ้าของ, and returns rows ONLY when the whole file is clean —
// so this function either writes everything or writes nothing. That matters at
// 64 rows: a partial import leaves nobody able to tell which half landed.
//
// `supplier_id` is set from ownerId, never from the file: spec 275 id-mirrors an
// owner into `suppliers` to keep the GL-party edge in step, and createEquipment
// does the same.
// ---------------------------------------------------------------------------
export interface ImportEquipmentResult {
  ok: boolean;
  inserts: number;
  updates: number;
  errors: string[];
}

export async function importEquipmentCsv(
  csvText: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportEquipmentResult> {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const supabase = await createServerSupabase();

  const [{ data: cats }, { data: owners }, { data: items }] = await Promise.all([
    supabase.from("equipment_categories").select("id, name"),
    supabase.from("equipment_owners").select("id, name"),
    supabase.from("equipment_items").select("id"),
  ]);

  const parsed = parseEquipmentImport(csvText, {
    categoriesByName: new Map((cats ?? []).map((c) => [c.name, c.id])),
    ownersByName: new Map((owners ?? []).map((o) => [o.name, o.id])),
    existingIds: new Set((items ?? []).map((i) => i.id)),
    // This route is BACK_OFFICE_ROLES-only, so the reader is always the money
    // audience; money is still refused per-cell because it is unwritable.
    allowMoney: true,
  });

  if (parsed.errors.length > 0) {
    return { ok: false, inserts: 0, updates: 0, errors: parsed.errors };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, inserts: 0, updates: 0, errors: ["ไม่พบข้อมูลในไฟล์"] };
  }

  // Preview: the file is clean, so report what WOULD happen and write nothing.
  // At 64 rows the operator should see "add 3, update 61" before committing —
  // an import that only tells you what it did after the fact is not reviewable.
  if (options.dryRun) {
    return { ok: true, inserts: parsed.inserts, updates: parsed.updates, errors: [] };
  }

  const errors: string[] = [];
  let inserts = 0;
  let updates = 0;

  for (const row of parsed.rows) {
    const shared = {
      name: row.name,
      category_id: row.categoryId,
      owner_id: row.ownerId,
      supplier_id: row.ownerId,
      tracking: row.tracking,
      asset_tag: row.assetTag,
      quantity: row.quantity,
      status: row.status,
      brand: row.brand,
      model: row.model,
      serial_no: row.serialNo,
      condition: row.condition,
      description: row.description,
    };

    if (row.kind === "insert") {
      const { error } = await supabase
        .from("equipment_items")
        .insert({ ...shared, created_by: ctx.id });
      if (error) errors.push(`เพิ่ม "${row.name}" ไม่สำเร็จ`);
      else inserts += 1;
    } else {
      const { error } = await supabase.from("equipment_items").update(shared).eq("id", row.id!);
      if (error) errors.push(`แก้ไข "${row.name}" ไม่สำเร็จ`);
      else updates += 1;
    }
  }

  revalidatePath("/equipment");
  return { ok: errors.length === 0, inserts, updates, errors };
}
