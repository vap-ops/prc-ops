"use server";

// Spec 381 U2 — read one item's history for the ประวัติ sheet.
//
// Its own file, not `actions.ts`: that module is a busy shared surface and this
// is a pure read with a different gate story. Everything that matters lives in
// the U1 `equipment_item_history` RPC — role gate, the money omission, and the
// union across movements / loans / audit rows — so this is deliberately a thin
// pass-through. Re-implementing any part of that here would create a second copy
// of an authority rule.
//
// No `requireRole` here on purpose: the RPC raises 42501 itself for anyone
// outside the /equipment audience, and mirroring that list in TypeScript is the
// spec-187 affordance-then-refuse trap in reverse — a second list that can drift
// from the one that actually decides.

import "server-only";

import { createClient as createServerSupabase } from "@/lib/db/server";

export interface EquipmentHistoryEntry {
  occurredAt: string;
  kind: string;
  actorId: string | null;
  detail: Record<string, unknown> | null;
}

export type EquipmentHistoryResult =
  | { ok: true; entries: EquipmentHistoryEntry[] }
  | { ok: false; error: string };

export async function loadEquipmentHistory(itemId: string): Promise<EquipmentHistoryResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("equipment_item_history", { p_item_id: itemId });

  if (error) {
    // 42501 is the RPC's own gate. Say so plainly rather than inviting a retry
    // that can never succeed (the honest-copy class, #823/#826/#827).
    if (error.code === "42501") return { ok: false, error: "ไม่มีสิทธิ์ดูประวัติอุปกรณ์" };
    return { ok: false, error: "โหลดประวัติไม่สำเร็จ กรุณาลองใหม่" };
  }

  return {
    ok: true,
    entries: (data ?? []).map((r) => ({
      occurredAt: r.occurred_at,
      kind: r.kind,
      actorId: r.actor_id,
      detail: (r.detail ?? null) as Record<string, unknown> | null,
    })),
  };
}
