"use server";

// Spec 382 U2 — attach or clear ONE photo slot on an existing item.
//
// Its own file, not `actions.ts`: that module is already a busy shared surface
// and this is the only writer of the new table.
//
// `upsert` on the (item_id, kind) unique constraint is what makes a slot
// REPLACEABLE rather than accumulating — the DB constraint and this call agree by
// construction instead of by a read-then-write race.
//
// The `image_path` mirror is NOT maintained here: the U1 trigger owns it, so
// there is exactly one writer for that column and no drift between the two.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { UUID_REGEX } from "@/lib/validate/uuid";
import { isOwnItemImagePath } from "@/lib/equipment/image-path";
import { EQUIPMENT_PHOTO_KINDS, type EquipmentPhotoKind } from "@/lib/equipment/photo-kinds";
import type { EquipmentActionResult } from "@/app/equipment/actions";

const GENERIC_ERROR = "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export async function setEquipmentItemPhoto(input: {
  itemId: string;
  kind: string;
  path: string | null;
}): Promise<EquipmentActionResult> {
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  if (!UUID_REGEX.test(input.itemId)) return { ok: false, error: GENERIC_ERROR };
  if (!EQUIPMENT_PHOTO_KINDS.includes(input.kind as EquipmentPhotoKind)) {
    return { ok: false, error: GENERIC_ERROR };
  }
  // Same rule as every other equipment image write: the file must sit in THIS
  // item's own folder at depth 1 — the only shape the storage policy admits, and
  // the check that stops a crafted call pointing a row at another item's folder.
  if (!isOwnItemImagePath(input.itemId, input.path)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createServerSupabase();

  if (input.path === null) {
    const { error } = await supabase
      .from("equipment_item_photos")
      .delete()
      .eq("item_id", input.itemId)
      .eq("kind", input.kind as EquipmentPhotoKind);
    if (error) {
      if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขรูปอุปกรณ์" };
      return { ok: false, error: GENERIC_ERROR };
    }
    revalidatePath("/equipment");
    return { ok: true };
  }

  const { error } = await supabase.from("equipment_item_photos").upsert(
    {
      item_id: input.itemId,
      kind: input.kind as EquipmentPhotoKind,
      storage_path: input.path,
      created_by: ctx.id,
    },
    { onConflict: "item_id,kind" },
  );
  if (error) {
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์แก้ไขรูปอุปกรณ์" };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/equipment");
  return { ok: true };
}
