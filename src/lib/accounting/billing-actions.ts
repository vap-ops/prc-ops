// Spec 204 — status predicates that gate the client-billing + retention write
// controls. They mirror the RPC guards exactly (certify_client_billing accepts a
// draft|submitted claim; mark_retention_due accepts held; release_retention accepts
// held|due) so the UI only ever offers a legal action. Status arrives as a raw
// string from the register loaders, so an unknown value is never actionable.

import type { UserRole } from "@/lib/db/enums";
import { PM_ROLES } from "@/lib/auth/role-home";

// Who may write billings/retention. The certify / mark-due / release RPCs admit
// the PM tier INCLUDING project_director (a see-all PM — migration 20260751000000
// widened all three gates; an earlier comment here saying "NOT project_director"
// predated it). Derived from the PM_ROLES SSOT rather than re-listed, so the gate
// tracks the manager set in one place (operator confirmed PD 2026-06-26).
export const BILLING_WRITE_ROLES: readonly UserRole[] = [...PM_ROLES];

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

// The shared generic failure message for accounting write actions (billings,
// retention, manual journal). Hoisted next to AccountingActionResult so every
// accounting action surfaces one consistent Thai message instead of re-inlining it.
export const ACCOUNTING_ACTION_ERROR = "ทำรายการไม่สำเร็จ กรุณาลองใหม่";
