"use server";

// Spec 323 U1d — attach a receipt document (vendor tax invoice / payment slip) to a
// rental settlement. rental_settlement_attachments is a ZERO-GRANT money-adjacent
// table, so the metadata row is written through the ADMIN (service-role) client
// behind requireRole(BACK_OFFICE_ROLES) — NOT the RLS client / an authenticated
// INSERT policy. A mirrored authenticated policy would have to `exists (… from
// rental_settlements …)`, but that table is zero-grant → the subquery is empty for
// the caller → the policy always denies; and granting select on the ฿ table to make
// it work would break the money invariant (spec 323 review HIGH catch). So: the
// bytes were already uploaded to the private bucket by the client (a BACK_OFFICE-
// scoped storage policy), and this action inserts only the metadata, REBUILDING the
// canonical path (a client-supplied path is never trusted). Idempotent on replay.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { buildRentalReceiptPath } from "@/lib/equipment/rental-receipt-path";
import { isValidAttachmentExt } from "@/lib/purchasing/attachment-file";
import type { Database } from "@/lib/db/database.types";

export type RentalReceiptPurpose = Database["public"]["Enums"]["rental_receipt_purpose"];

export interface AddRentalSettlementReceiptInput {
  settlementId: string;
  attachmentId: string;
  ext: string;
  purpose: RentalReceiptPurpose;
}

export type RentalReceiptResult = { ok: true } | { ok: false; error: string };

const ERR = "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่";

export async function addRentalSettlementReceipt(
  input: AddRentalSettlementReceiptInput,
): Promise<RentalReceiptResult> {
  // Defense-in-depth gate: the money page is BACK_OFFICE-only, and so is this write.
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  if (!isValidAttachmentExt(input.ext)) return { ok: false, error: ERR };
  if (input.purpose !== "payment_slip" && input.purpose !== "tax_invoice") {
    return { ok: false, error: ERR };
  }
  const storagePath = buildRentalReceiptPath(input.settlementId, input.attachmentId, input.ext);
  if (!storagePath) return { ok: false, error: ERR };

  const admin = createAdminClient();

  // The settlement must exist. rental_settlements is zero-grant, so this read (and
  // the insert below) go through the admin client.
  const { data: settlement } = await admin
    .from("rental_settlements")
    .select("id")
    .eq("id", input.settlementId)
    .maybeSingle();
  if (!settlement) return { ok: false, error: ERR };

  const { error } = await admin.from("rental_settlement_attachments").insert({
    id: input.attachmentId,
    settlement_id: input.settlementId,
    storage_path: storagePath,
    purpose: input.purpose,
    uploaded_by: ctx.id,
  });
  // 23505 = the metadata row already exists (a retried upload of the same object) —
  // idempotent success, mirroring addExpenseReceipt.
  if (error && error.code !== "23505") return { ok: false, error: ERR };

  revalidatePath("/equipment/rentals");
  return { ok: true };
}
