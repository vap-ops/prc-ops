"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";

// Spec 283 U1 — "run now": record one manual scan, then refresh the board.
// The RPC is super_admin-gated (definer); this action re-guards at the TS layer.
export async function runIntegrityNow(): Promise<void> {
  await requireRole(["super_admin"]);
  const supabase = await createClient();
  await supabase.rpc("run_and_record_integrity");
  revalidatePath("/settings/integrity");
}
