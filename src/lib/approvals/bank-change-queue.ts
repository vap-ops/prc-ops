// Spec 186 U1 / spec 170 U4c-2 — the pure builders behind the bank-change
// approval queue page. Each pending request joins to its party name (fallback
// "—") for display, tagged with a `kind` so the page routes the approve/reject to
// the correct decide RPC (contractor → contact_bank; worker → workers.bank_*).
// Pure (no Supabase) so they're unit-testable; the page does the admin-read +
// name fetch + merge.

export interface BankChangeRequestRow {
  id: string;
  contractor_id: string;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  created_at: string;
}

export interface WorkerBankChangeRequestRow {
  id: string;
  worker_id: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  /** Spec 315 U2 — the request's passbook photo (nullable: legacy rows). */
  book_bank_path: string | null;
  created_at: string;
}

export interface BankChangeQueueItem {
  id: string;
  kind: "contractor" | "worker";
  name: string;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
  /** Worker kind only (spec 315 U2) — the page signs it for the photo render. */
  bookBankPath?: string | null;
  createdAt: string;
}

export function buildBankChangeQueue(
  rows: ReadonlyArray<BankChangeRequestRow>,
  contractorsById: ReadonlyMap<string, string>,
): BankChangeQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    kind: "contractor",
    name: contractorsById.get(r.contractor_id) ?? "—",
    bankName: r.bank_name,
    accountNo: r.bank_account_no,
    accountName: r.bank_account_name,
    createdAt: r.created_at,
  }));
}

export function buildWorkerBankChangeQueue(
  rows: ReadonlyArray<WorkerBankChangeRequestRow>,
  workersById: ReadonlyMap<string, string>,
): BankChangeQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    kind: "worker",
    name: workersById.get(r.worker_id) ?? "—",
    bankName: r.bank_name,
    accountNo: r.bank_account_number,
    accountName: r.bank_account_name,
    bookBankPath: r.book_bank_path,
    createdAt: r.created_at,
  }));
}

// ----------------------------------------------------------------------------
// Spec 317 U3 — identity change requests (legal name / national ID / DOB) join
// the same approval queue. Kind "identity" routes the decision to
// decide_identity_change (STAFF_APPROVAL_ROLES; a PM viewing the page gets a
// clear refusal from the action, same posture as procurement_manager on
// contractor rows).
// ----------------------------------------------------------------------------

export interface IdentityChangeRequestRow {
  id: string;
  user_id: string;
  proposed_full_name: string | null;
  proposed_national_id: string | null;
  proposed_dob: string | null;
  created_at: string;
}

export interface IdentityQueueItem {
  id: string;
  kind: "identity";
  /** The requester's CURRENT display name (what the change moves away from). */
  name: string;
  proposedFullName: string | null;
  proposedNationalId: string | null;
  proposedDob: string | null;
  createdAt: string;
}

export function buildIdentityChangeQueue(
  rows: ReadonlyArray<IdentityChangeRequestRow>,
  usersById: ReadonlyMap<string, string>,
): IdentityQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    kind: "identity",
    name: usersById.get(r.user_id) ?? "—",
    proposedFullName: r.proposed_full_name,
    proposedNationalId: r.proposed_national_id,
    proposedDob: r.proposed_dob,
    createdAt: r.created_at,
  }));
}
