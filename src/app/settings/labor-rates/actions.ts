"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireActionRole } from "@/lib/auth/action-gate";
import type { UserRole, WhtBasis } from "@/lib/db/enums";
import type { WorkerLevel } from "@/lib/nova/dials";

// The rate/WHT config is money-set: exactly the DEFINER RPCs' gate
// (set_level_rate / set_labor_wht_pct allow procurement_manager + super_admin
// only). A fresh explicit array, NOT a PM_ROLES-derived set — plain
// project_manager/project_director are NOT permitted here, so a widen of the
// manager tier must never silently open this door.
const RATE_ROLES: readonly UserRole[] = ["procurement_manager", "super_admin"];

export type LaborRateResult = { ok: true } | { ok: false; error: string };

export interface SetLevelRateInput {
  level: WorkerLevel;
  rate: number | null;
  basis: WhtBasis;
}

// Set the firm-wide standard day-rate + WHT basis for one skill level. The DEFINER
// RPC enforces the money gate + the non-negative check server-side; requireActionRole
// + the range pre-check here are the friendly early guard and defense-in-depth.
export async function setLevelRate(input: SetLevelRateInput): Promise<LaborRateResult> {
  if (input.rate !== null && (!Number.isFinite(input.rate) || input.rate < 0)) {
    return { ok: false, error: "อัตราค่าแรงต้องเป็นตัวเลขไม่ติดลบ" };
  }
  const gate = await requireActionRole(RATE_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("set_level_rate", {
    p_level: input.level,
    // p_entered_rate is nullable at the DB (null clears the rate), but supabase-js
    // types the numeric arg as non-null; the null is honest and the RPC handles it.
    p_entered_rate: input.rate as number,
    p_basis: input.basis,
  });
  if (error) return { ok: false, error: "บันทึกอัตราไม่สำเร็จ" };

  revalidatePath("/settings/labor-rates");
  return { ok: true };
}

// Set the firm-wide WHT %. The RPC enforces the gate + the [0,100) range server-side.
export async function setWhtPct(pct: number | null): Promise<LaborRateResult> {
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct >= 100)) {
    return { ok: false, error: "เปอร์เซ็นต์ต้องอยู่ระหว่าง 0 ถึง 99.99" };
  }
  const gate = await requireActionRole(RATE_ROLES);
  if ("error" in gate) return { ok: false, error: gate.error };

  const { error } = await gate.auth.supabase.rpc("set_labor_wht_pct", {
    // Nullable at the DB (null clears the firm %); same honest-null cast as above.
    p_pct: pct as number,
  });
  if (error) return { ok: false, error: "บันทึกเปอร์เซ็นต์ไม่สำเร็จ" };

  revalidatePath("/settings/labor-rates");
  return { ok: true };
}
