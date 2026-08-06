"use server";

// Spec 392 U2a — the zone-map write paths. Each action shape-validates, then
// relays to the SECURITY DEFINER RPC that is the load-bearing authorisation
// (`is_manager(current_user_role())` + `can_see_project`, both raising 42501).
// Following the house rule, none of these re-reads the caller's role: the RPC
// decides, and this layer maps its SQLSTATEs to Thai the user can act on.

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import type { Json } from "@/lib/db/database.types";
import { zonesHref } from "@/lib/nav/project-paths";
import { isValidUuid } from "@/lib/validate/uuid";
import {
  validateZoneCode,
  validateZoneGeometry,
  type ZoneGeometry,
  type ZoneShape,
} from "@/lib/zones/validate-zone";
import { validateZoneName } from "@/lib/zones/validate-zone";

// Every refusal the RPC layer can produce, said once. `42501` is the role or
// membership gate; `22023` is a shape the DB refused; `23505` is the per-map
// unique code.
const NOT_MANAGER = "เฉพาะผู้จัดการโครงการเท่านั้นที่แก้ผังโซนได้";
const DUPLICATE_CODE = "รหัสโซนนี้มีอยู่แล้วในผังนี้ กรุณาใช้รหัสอื่น";
const SAVE_FAILED = "บันทึกโซนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

// A zone added from the LIST has no drawn geometry yet, so it lands as a small
// rect the editor can drag. Deliberately inside the unit box and comfortably
// clear of the edges — the DB would refuse anything that overflows.
const DEFAULT_ZONE_GEOMETRY: ZoneGeometry = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };

export type ZoneActionResult = { ok: true; id: string } | { ok: false; error: string };
export type ZoneDeleteResult = { ok: true } | { ok: false; error: string };

export interface SaveZoneInput {
  projectId: string;
  mapId: string;
  /** Omit to create; pass the id to rename/reshape an existing zone. */
  zoneId?: string;
  code: string;
  name: string;
  shape?: ZoneShape;
  geometry?: ZoneGeometry;
  // ⚠️ Deliberately NOT `string | null`. The RPC now coalesces `p_parent_zone_id`,
  // so passing null to UN-nest a zone would return ok, fire a refresh, and leave
  // the zone exactly where it was — the silent-success class (#791). Nothing in
  // the UI nests or un-nests today; when an un-nest affordance exists it needs
  // its own RPC arm, and this type should stop advertising one until then.
  parentZoneId?: string;
  sortOrder?: number;
}

export async function saveZone(input: SaveZoneInput): Promise<ZoneActionResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  if (!isValidUuid(input.mapId)) return { ok: false, error: "ไม่พบผังโซนของโครงการนี้" };
  if (input.zoneId !== undefined && !isValidUuid(input.zoneId))
    return { ok: false, error: "ไม่พบโซนนี้" };
  if (input.parentZoneId != null && !isValidUuid(input.parentZoneId))
    return { ok: false, error: "ไม่พบโซนแม่" };

  const codeResult = validateZoneCode(input.code);
  if (!codeResult.ok) return { ok: false, error: codeResult.error };
  const nameResult = validateZoneName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  // ⭐ Defaults belong to the CREATE path only. `upsert_project_zone` reads a
  // NULL as "leave this column alone" (migration 20260813075911), so an UPDATE
  // that fills the gaps with `rect` + the default box does not merely miss the
  // point — it OVERWRITES. That is what made the rename sheet, which sends
  // {zoneId, code, name} and nothing else, reset a drawn zone to the same
  // default rectangle. The two halves have to agree: the RPC stopped clobbering
  // on null, and this stops manufacturing non-nulls.
  // `=== undefined` is safe despite `p_zone_id` below using `?? null`: a review
  // asked whether `zoneId: null` could disagree across the three checks and take
  // the DB's CREATE arm with a null shape (23502 behind a generic message).
  // Refuted — `isValidUuid` is `(value: unknown)` and false for null, so the
  // guard above already returns ไม่พบโซนนี้ and nothing reaches here.
  const isCreate = input.zoneId === undefined;
  const shape: ZoneShape | null = input.shape ?? (isCreate ? "rect" : null);
  const geometry = input.geometry ?? (isCreate ? DEFAULT_ZONE_GEOMETRY : null);

  // Validate only what is actually being written. A partial update sends no
  // geometry, so there is nothing to check — and checking the STORED geometry
  // would need a read this action deliberately does not do.
  if (shape !== null && geometry !== null) {
    const geometryResult = validateZoneGeometry(shape, geometry);
    if (!geometryResult.ok) return { ok: false, error: geometryResult.error };
  } else if (shape !== null || geometry !== null) {
    // Shape and geometry are one fact, not two: `{x,y,w,h}` under `polygon` is
    // a row the DB CHECK refuses. Sending one without the other would ask the
    // database to validate a pairing that only half exists.
    return { ok: false, error: "ต้องระบุรูปทรงและตำแหน่งของโซนคู่กัน" };
  }

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { data, error } = await auth.supabase.rpc("upsert_project_zone", {
    p_map_id: input.mapId,
    // `p_zone_id` NULL is how the RPC is told "create"; `p_parent_zone_id` NULL
    // means top level. Both are nullable at the DB, but the generated Args type
    // models function arguments as non-null, so the cast is the house workaround
    // (same as `p_lead` in src/app/sa/plan/actions.ts). null reaches PG as SQL NULL.
    p_zone_id: (input.zoneId ?? null) as unknown as string,
    p_code: codeResult.code,
    p_name: nameResult.name,
    p_shape: shape as unknown as ZoneShape,
    p_geometry: geometry as unknown as Json,
    p_parent_zone_id: (input.parentZoneId ?? null) as unknown as string,
    // Null, not 0, on an update: `sort_order` is coalesced at the DB, so a
    // rename that sends 0 would send a zone back to the top of its map.
    p_sort_order: (input.sortOrder ?? (isCreate ? 0 : null)) as unknown as number,
  });
  if (error) {
    console.error("[saveZone] RPC failed", { mapId: input.mapId, error: error.message });
    if (error.code === "42501") return { ok: false, error: NOT_MANAGER };
    if (error.code === "23505") return { ok: false, error: DUPLICATE_CODE };
    if (error.code === "22023") return { ok: false, error: "ข้อมูลโซนไม่ถูกต้อง" };
    return { ok: false, error: SAVE_FAILED };
  }
  if (!data) return { ok: false, error: SAVE_FAILED };

  revalidatePath(zonesHref(input.projectId));
  return { ok: true, id: data };
}

export interface DeleteZoneInput {
  projectId: string;
  zoneId: string;
}

export async function deleteZone(input: DeleteZoneInput): Promise<ZoneDeleteResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  if (!isValidUuid(input.zoneId)) return { ok: false, error: "ไม่พบโซนนี้" };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("delete_project_zone", { p_zone_id: input.zoneId });
  if (error) {
    console.error("[deleteZone] RPC failed", { zoneId: input.zoneId, error: error.message });
    if (error.code === "42501") return { ok: false, error: NOT_MANAGER };
    if (error.code === "22023") return { ok: false, error: "ไม่พบโซนนี้" };
    return { ok: false, error: "ลบโซนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(zonesHref(input.projectId));
  return { ok: true };
}

export interface CreateZoneMapInput {
  projectId: string;
  name: string;
}

// The project's first map. `save_project_zone_map` also updates an existing one
// (U2b uses that for the background image); U2a only needs the create arm, so
// `p_map_id` is null here and nothing else is sent.
export async function createZoneMap(input: CreateZoneMapInput): Promise<ZoneActionResult> {
  if (!isValidUuid(input.projectId)) return { ok: false, error: "รหัสโครงการไม่ถูกต้อง" };
  const nameResult = validateZoneName(input.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  // The three optional args (background, sheet code, sheet rev) are OMITTED
  // rather than sent as null: they carry SQL defaults, so leaving them out is
  // the same call with no cast. Only `p_map_id` has to be an explicit NULL —
  // that is what selects the create arm.
  const { data, error } = await auth.supabase.rpc("save_project_zone_map", {
    p_project_id: input.projectId,
    p_map_id: null as unknown as string,
    p_name: nameResult.name,
  });
  if (error) {
    console.error("[createZoneMap] RPC failed", {
      projectId: input.projectId,
      error: error.message,
    });
    if (error.code === "42501") return { ok: false, error: NOT_MANAGER };
    return { ok: false, error: "สร้างผังโซนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  if (!data) return { ok: false, error: "สร้างผังโซนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

  revalidatePath(zonesHref(input.projectId));
  return { ok: true, id: data };
}
