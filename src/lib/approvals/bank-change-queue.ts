// Spec 186 U1 — the pure builder behind the contractor bank-change approval
// queue. Joins each pending request to its contractor name for display. Pure
// (no Supabase) so it's unit-testable; the page does the admin-read + name fetch.

export interface BankChangeRequestRow {
  id: string;
  contractor_id: string;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  created_at: string;
}

export interface BankChangeQueueItem {
  id: string;
  contractorName: string;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
  createdAt: string;
}

export function buildBankChangeQueue(
  rows: ReadonlyArray<BankChangeRequestRow>,
  contractorsById: ReadonlyMap<string, string>,
): BankChangeQueueItem[] {
  return rows.map((r) => ({
    id: r.id,
    contractorName: contractorsById.get(r.contractor_id) ?? "—",
    bankName: r.bank_name,
    accountNo: r.bank_account_no,
    accountName: r.bank_account_name,
    createdAt: r.created_at,
  }));
}
