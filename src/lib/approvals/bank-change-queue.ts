import { normaliseThaiPersonName } from "@/lib/workers/thai-name";

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
  kind: "contractor" | "worker" | "staff-bank";
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

// Spec 321 U8b: the login-keyed (user_bank) queue kind is retired — that bank
// edit went INSTANT + inline (U8a, record_own_user_bank), the 3 legacy pending
// rows were applied, and the queue is empty. The submit_/decide_user_bank_change
// RPCs + the user_bank_change_requests table remain (non-destructive), but no UI
// stages or drains them, so buildUserBankChangeQueue is gone.

/**
 * Spec 395 U3 — does this bank-change request name a holder who is not the ช่าง?
 *
 * The SECOND door into `workers.bank_*` (§2). `/workers` is not the only path: a ช่าง's
 * own self-service request, approved here, writes all three bank columns and equally
 * bypasses the nominee record. This gives the approver the same signal the roster gives
 * the editor, at the moment of approval.
 *
 * ⚠️ ADVISORY ONLY — it must never block an approval. A family member's account is
 * normal at this firm, and the approver, not this predicate, knows whose account it is.
 *
 * ⚠️ WORKER kind only. A contractor's account holder is a FIRM, so comparing it to a
 * person's name would fire on nearly every contractor request and train the approver to
 * ignore the notice; staff-bank belongs to spec 317 and its `name` semantics are not
 * verified here.
 *
 * ⓘ Measured 2026-08-05: `worker_bank_change_requests` holds ONE row all-time and zero
 * pending, so this is a thin guard on a near-dormant path — built because the door is
 * real, not because it is busy. U1's detector badges whatever arrives through it anyway.
 */
export function requestedAccountNameDiffers(item: BankChangeQueueItem): boolean {
  if (item.kind !== "worker") return false;
  // ⚠️ `name` is the builder's DISPLAY value and falls back to "—" when the worker id
  // did not resolve. Flagging on that would assert "the account name does not match the
  // ช่าง's" about a ช่าง whose name was never known — a claim made from ignorance, which
  // is the opposite of what this advisory is for.
  if (item.name === "—") return false;
  const person = normaliseThaiPersonName(item.name);
  const holder = normaliseThaiPersonName(item.accountName ?? "");
  // ⚠️ An empty normalisation is an ABSENCE of evidence, not a match — the same rule
  // isNormalisingRename enforces. A blank or honorific-only holder must never read as
  // "this is theirs"; it is exactly the case worth a second look.
  if (person === "" || holder === "") return true;
  return person !== holder;
}
