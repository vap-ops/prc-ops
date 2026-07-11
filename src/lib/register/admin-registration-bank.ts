import "server-only";

// Spec 296 U3 — the approver's read of an applicant's declared bank (bank name /
// account no / account holder). The typed bank lives in the ZERO-GRANT table
// staff_registration_bank (service_role-only; RLS on with no authenticated
// policy) so in-project site_admins never see applicant bank PII — ADR 0079's
// money-governance wall. So, unlike the other approval-detail row reads (which go
// on the caller's own RLS session — see admin-registrations.ts), this ONE read
// uses the service-role admin client, scoped to the single registration the
// approver already passed requireRole(STAFF_APPROVAL_ROLES) + the RLS row read
// for. Same exposure model as admin-line-identity / display-names: the row-level
// authorization the caller already cleared is the gate; the admin client only
// surfaces a field for a registration the caller may see. Only the three bank
// fields leave this module.

import { createClient as createAdminClient } from "@/lib/db/admin";

export interface RegistrationBank {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export async function getRegistrationBank(
  registrationId: string,
): Promise<RegistrationBank | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("staff_registration_bank")
    .select("bank_name, bank_account_number, bank_account_name")
    .eq("registration_id", registrationId)
    .maybeSingle();
  return data
    ? {
        bankName: data.bank_name,
        accountNumber: data.bank_account_number,
        accountName: data.bank_account_name,
      }
    : null;
}
