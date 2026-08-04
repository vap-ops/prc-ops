// Spec 396 U4 — pending STAFF-APPROVAL count for the dashboard card.
//
// `/contacts/bank-changes` decides four kinds of request, but the dashboard only ever
// counted two of them (contractor + worker bank, spec 184 U2 / 170 U4c-2). Since
// AwarenessCard renders nothing at count<=0, a day with no bank changes left the queue
// with NO DOOR at all — which is how four identity requests reached 20 days old, with
// zero decided all-time and the page's last visit falling the day BEFORE the oldest of
// them was filed.
//
// Deliberately NOT folded into getPendingBankChangeCount, for two independent reasons:
//
//  1. Different audience. The live RLS read arms split the four kinds in half:
//     contractor/worker bank → project_manager, super_admin, project_director (PM_ROLES,
//     matching the bank card's isManager gate); identity/staff_bank → procurement_manager,
//     project_director, super_admin (STAFF_APPROVAL_ROLES, matching the page's own
//     `canSeeTrioKinds`). One card cannot be gated correctly for both.
//  2. Different label. The bank card reads "การเปลี่ยนบัญชีรอการอนุมัติ" — adding identity
//     rows to that number would make the label untrue.
//
// RLS scopes both reads to the caller, so the count is honest per role and a non-approver
// can never be shown work they cannot open. Best-effort PER KIND: one table failing
// contributes 0 without zeroing the other, so a blip on the quiet table cannot hide the
// requests that are actually waiting — and each query absorbs a REJECTION as well as a
// returned `error`, because these run inside the dashboard's own Promise.all, where one
// rejected query would take the whole page render down with it.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type HeadCount = { count: number | null; error: unknown };

const settled = (r: HeadCount): number => (r.error ? 0 : (r.count ?? 0));

export async function getPendingStaffApprovalCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const [identity, staffBank] = await Promise.all([
    Promise.resolve(
      supabase
        .from("identity_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ).then(settled, () => 0),
    Promise.resolve(
      supabase
        .from("staff_bank_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ).then(settled, () => 0),
  ]);
  return identity + staffBank;
}
