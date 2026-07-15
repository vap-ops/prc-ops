"use server";

// Spec 321 U2 — one server dispatch for the unified ProfileBankSection. The 4
// former clone forms each called their own submit action (2 modules, differing
// signatures — worker/contractor need a revalidate path, staff/user don't).
// This branches to the SAME existing actions by audience, so behavior is
// unchanged; only the client surface is unified.

import { submitBankChange, submitWorkerBankChange, type ActionResult } from "@/lib/portal/actions";
import { submitStaffBankChange, submitUserBankChange } from "@/app/settings/my-info/actions";
import type { BankAudience } from "./bank-audience";

export interface BankChangePayload {
  bankName: string;
  accountNo: string;
  accountName: string;
  attachmentId: string;
  ext: string;
}

export async function submitProfileBankChange(
  audience: BankAudience,
  payload: BankChangePayload,
): Promise<ActionResult> {
  switch (audience) {
    case "worker":
      return submitWorkerBankChange({ ...payload, revalidate: "/technician" });
    case "contractor":
      return submitBankChange({ ...payload, revalidate: "/portal" });
    case "staff":
      return submitStaffBankChange(payload);
    case "user":
      return submitUserBankChange(payload);
  }
}
