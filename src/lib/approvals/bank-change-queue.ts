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
  /** Spec 317 U5 — the request passbook photo (nullable: legacy rows). */
  bank_book_path: string | null;
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
  kind: "contractor" | "worker" | "staff-bank" | "user-bank";
  name: string;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
  /** All bank kinds (spec 315 U2 / 317 U4 / 317 U5) — the page signs it for the photo render. */
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
    bookBankPath: r.bank_book_path,
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

// ----------------------------------------------------------------------------
// Spec 317 U4 — staff bank changes (staff_registration_bank home). Same card
// shape as the worker kind (typed fields + passbook photo); decided by the
// staff-approval trio, so the page trio-gates the fetch like identity rows.
// ----------------------------------------------------------------------------

export interface StaffBankChangeRequestRow {
  id: string;
  registration_id: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  book_bank_path: string;
  created_at: string;
}

export function buildStaffBankChangeQueue(
  rows: ReadonlyArray<StaffBankChangeRequestRow>,
  namesByRegistration: ReadonlyMap<string, string>,
): BankChangeQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    kind: "staff-bank",
    name: namesByRegistration.get(r.registration_id) ?? "—",
    bankName: r.bank_name,
    accountNo: r.bank_account_number,
    accountName: r.bank_account_name,
    bookBankPath: r.book_bank_path,
    createdAt: r.created_at,
  }));
}

// ----------------------------------------------------------------------------
// Spec 319 — login-keyed bank changes (user_bank home) for the admin/office
// tier with no worker/contractor/registration home. Same card shape as the
// worker/staff kinds (typed fields + passbook photo); decided by the
// staff-approval trio, so the page trio-gates the fetch like the staff-bank rows.
// ----------------------------------------------------------------------------

export interface UserBankChangeRequestRow {
  id: string;
  user_id: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  book_bank_path: string;
  created_at: string;
}

export function buildUserBankChangeQueue(
  rows: ReadonlyArray<UserBankChangeRequestRow>,
  namesByUser: ReadonlyMap<string, string>,
): BankChangeQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    kind: "user-bank",
    name: namesByUser.get(r.user_id) ?? "—",
    bankName: r.bank_name,
    accountNo: r.bank_account_number,
    accountName: r.bank_account_name,
    bookBankPath: r.book_bank_path,
    createdAt: r.created_at,
  }));
}
