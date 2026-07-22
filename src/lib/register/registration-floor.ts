// Spec 264 G2 / spec 296 — pure view-model for the one-page self-service form:
// which of the approve_staff_registration DB floor's requirements are still
// missing, so the page can show a plain "required for approval" checklist. The
// floor mirrors the RPC's floor exactly (spec 296): full_name + a live id_card
// attachment + a live book_bank passbook photo + declared bank fields + a live
// PDPA consent record. `profile_photo` is intentionally never part of the floor —
// it's optional (the e-card falls back to the LINE avatar). Pure — no RPC/DB access.

import type { StaffDocPurpose } from "@/lib/register/document-types";

export type ApprovalRequirement = "full_name" | "id_card" | "book_bank" | "bank_fields" | "consent";

export interface ApprovalFloorInput {
  fullName: string | null;
  hasIdCard: boolean;
  hasBookBank: boolean;
  hasBankFields: boolean;
  hasConsent: boolean;
  /** Spec 328 — subcon members are pay-exempt (the firm is paid per WP, PRC never
   *  collects their bank): mirrors the approve RPC's contractor arm, which skips
   *  the book_bank + bank-fields floors. id_card + PDPA floors stay. */
  bankExempt?: boolean;
}

export interface ApprovalFloor {
  met: boolean;
  missing: ApprovalRequirement[];
}

export function registrationApprovalFloor(input: ApprovalFloorInput): ApprovalFloor {
  const missing: ApprovalRequirement[] = [];
  if (!(input.fullName ?? "").trim()) missing.push("full_name");
  if (!input.hasIdCard) missing.push("id_card");
  if (!input.bankExempt) {
    if (!input.hasBookBank) missing.push("book_bank");
    if (!input.hasBankFields) missing.push("bank_fields");
  }
  if (!input.hasConsent) missing.push("consent");
  return { met: missing.length === 0, missing };
}

/**
 * Spec 343 U1 — ONE derivation of the floor input from loaded registration data.
 * The pending notice (server, in RegistrationWorkspace) and the form (client)
 * both need to know what is still outstanding; deriving it in two places is how
 * they would come to disagree. Pure — no DB access, no signed-URL fetching.
 */
export interface LoadedRegistrationFloorInput {
  fullName: string | null;
  /** Signed URLs of the CURRENT upload per purpose (getOwnRegistrationDocuments). */
  docUrls: Partial<Record<StaffDocPurpose, string>>;
  consentedAt: string | null;
  /** True once a staff_registration_bank row is PERSISTED — never typed state. */
  bankSaved: boolean;
  bankExempt: boolean;
}

export function approvalFloorFromLoaded(input: LoadedRegistrationFloorInput): ApprovalFloor {
  return registrationApprovalFloor({
    fullName: input.fullName,
    hasIdCard: Boolean(input.docUrls.id_card),
    hasBookBank: Boolean(input.docUrls.book_bank),
    hasBankFields: input.bankSaved,
    hasConsent: Boolean(input.consentedAt),
    bankExempt: input.bankExempt,
  });
}
