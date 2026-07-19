import "server-only";

// Spec 320 U2 — server readers for the PM payout-nominee surface. The four
// worker_payout_nominee RPCs are DEFINER + procurement_manager-gated and the
// table is zero-grant bank PII (ADR 0079), so the RLS-session reads go through
// the RPCs. Worker display name + PRC code are workers-PII-walled, so they are
// resolved through the admin client for the (already PM-authorized) worker ids —
// the same seam discipline as badge-codes (spec 306).

import { createClient as createAdminClient } from "@/lib/db/admin";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

// Soft-worklist reclaim threshold (display-only pressure; no enforcement).
export const PAYOUT_NOMINEE_STALE_DAYS = 45;

export interface PayoutNomineeRow {
  workerId: string;
  payeeName: string;
  payeeBankName: string;
  accountNumber: string;
  setAt: string;
  daysActive: number;
}

export async function listActivePayoutNominees(
  supabase: ServerClient,
): Promise<PayoutNomineeRow[]> {
  const { data } = await supabase.rpc("list_active_payout_nominees");
  return (data ?? []).map((r) => ({
    workerId: r.worker_id,
    payeeName: r.payee_name,
    payeeBankName: r.payee_bank_name,
    accountNumber: r.payee_account_number,
    setAt: r.set_at,
    daysActive: r.days_active,
  }));
}

export interface PayoutNomineeDetail {
  payeeName: string;
  relationship: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  consentDocPath: string;
  setAt: string;
}

export async function getWorkerPayoutNominee(
  supabase: ServerClient,
  workerId: string,
): Promise<PayoutNomineeDetail | null> {
  const { data } = await supabase.rpc("get_worker_payout_nominee", { p_worker_id: workerId });
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? {
        payeeName: row.payee_name,
        relationship: row.payee_relationship,
        bankName: row.payee_bank_name,
        accountNumber: row.payee_account_number,
        accountName: row.payee_account_name,
        consentDocPath: row.consent_doc_path,
        setAt: row.set_at,
      }
    : null;
}

export interface WorkerRef {
  name: string;
  code: string | null;
}

// Resolve name + PRC code for the worklist's worker ids (walled columns → admin
// client). ⚠ MUST only be called from a procurement_manager-gated surface — the
// admin client bypasses RLS + the workers-PII wall, so the caller's requireRole
// gate IS the authorization (same discipline as the badge-codes seam, spec 306).
export async function fetchNomineeWorkerRefs(
  workerIds: ReadonlyArray<string>,
): Promise<Map<string, WorkerRef>> {
  if (workerIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, name, employee_id")
    .in("id", [...workerIds]);
  if (error) throw new Error(`payout-nominee refs: ${error.message}`);
  const map = new Map<string, WorkerRef>();
  for (const row of data ?? []) {
    map.set(row.id, { name: row.name, code: row.employee_id });
  }
  return map;
}

export interface BanklessWorker {
  id: string;
  name: string;
  code: string | null;
}

// The picker population: active workers with no bank account on file (the marker
// is NULL — verified live: 0 empty-string, 13 NULL) — the people a nominee is
// for. Spec 328 U3: contractor-tied workers are excluded (pay-exempt subcon
// members are permanently bankless BY DESIGN — the firm pays them, so routing a
// nominee payout for one would move money PRC never owes). ⚠ MUST only be
// called from a procurement_manager-gated surface (admin client bypasses RLS +
// the workers-PII wall; the caller's requireRole IS the authorization, per the
// badge-codes seam).
export async function listBanklessWorkers(): Promise<BanklessWorker[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, name, employee_id")
    .eq("active", true)
    .is("bank_account_number", null)
    .is("contractor_id", null)
    .order("name");
  if (error) throw new Error(`bankless workers: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, code: r.employee_id }));
}
