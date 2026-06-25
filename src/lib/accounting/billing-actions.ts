// Spec 204 — status predicates that gate the client-billing + retention write
// controls. They mirror the RPC guards exactly (certify_client_billing accepts a
// draft|submitted claim; mark_retention_due accepts held; release_retention accepts
// held|due) so the UI only ever offers a legal action. Status arrives as a raw
// string from the register loaders, so an unknown value is never actionable.

import type { UserRole } from "@/lib/db/enums";

// The certify / mark-due / release RPCs admit project_manager/super_admin exactly
// (NOT project_director) — the single source for who may write billings/retention.
export const BILLING_WRITE_ROLES: readonly UserRole[] = ["project_manager", "super_admin"];

const CERTIFIABLE = new Set(["draft", "submitted"]);
const RELEASABLE = new Set(["held", "due"]);

export function canCertifyBilling(status: string): boolean {
  return CERTIFIABLE.has(status);
}

export function canMarkRetentionDue(status: string): boolean {
  return status === "held";
}

export function canReleaseRetention(status: string): boolean {
  return RELEASABLE.has(status);
}

export type AccountingActionResult = { ok: true } | { ok: false; error: string };
