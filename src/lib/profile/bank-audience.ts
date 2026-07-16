// Spec 321 U2 — per-audience config for the ONE ProfileBankSection, isolating
// the handful of differences the 4 former clone bank-change forms carried. All
// four upload the passbook to the same CONTACT_DOCS_BUCKET; only the storage
// PATH builder, the accountName length cap, and the approver copy differ. The
// submit action itself is dispatched server-side (submit-profile-bank-change).
// U7 — the approver copy is now single-sourced from the labels SSOT.

import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { buildContactDocPath } from "@/lib/contacts/document-path";
import { type PhotoExt } from "@/lib/photos/path";
import {
  BANK_CHANGE_APPROVER_HR,
  BANK_CHANGE_APPROVER_PM,
  BANK_CHANGE_PENDING_HR,
  BANK_CHANGE_PENDING_PM,
  BANK_CHANGE_TOAST_HR,
  BANK_CHANGE_TOAST_PM,
  BANK_INSTANT_SUBTITLE,
  BANK_INSTANT_TOAST,
} from "@/lib/i18n/labels";

/**
 * approved — stage a change for the money approvers (worker/contractor → PM,
 * staff → HR trio): "ส่งคำขอ" + pending banner. instant — save directly for the
 * caller's own login-keyed user_bank (spec 321 U8a): "บันทึก" + toast, no
 * approval, no pending banner.
 */
export type BankTierMode = "approved" | "instant";

export type BankAudience = "worker" | "contractor" | "staff" | "user";

export interface BankAudienceConfig {
  /** approved (stage for approvers) vs instant (save directly, U8a). */
  tierMode: BankTierMode;
  /** accountName input cap — contractor 200, everyone else 120. */
  accountNameMax: number;
  /** approved: who reviews it; instant: "saves immediately". */
  subtitle: string;
  /** waiting banner shown while a request is pending (approved tier only). */
  pendingText: string;
  /** success toast after submit/save. */
  successToast: string;
  /** builds the caller-owned passbook storage path (bucket is always CONTACT_DOCS_BUCKET). */
  buildPhotoPath: (ownerId: string, attachmentId: string, ext: PhotoExt) => string | null;
}

const bookBankPath = (uid: string, attachmentId: string, ext: PhotoExt) =>
  buildTechnicianDocPath(uid, "book_bank", attachmentId, ext);

export const BANK_AUDIENCE: Record<BankAudience, BankAudienceConfig> = {
  worker: {
    tierMode: "approved",
    accountNameMax: 120,
    subtitle: BANK_CHANGE_APPROVER_PM,
    pendingText: BANK_CHANGE_PENDING_PM,
    successToast: BANK_CHANGE_TOAST_PM,
    buildPhotoPath: bookBankPath,
  },
  contractor: {
    tierMode: "approved",
    accountNameMax: 200,
    subtitle: BANK_CHANGE_APPROVER_PM,
    pendingText: BANK_CHANGE_PENDING_PM,
    successToast: BANK_CHANGE_TOAST_PM,
    buildPhotoPath: (id, attachmentId, ext) =>
      buildContactDocPath("contractor", id, attachmentId, ext),
  },
  staff: {
    tierMode: "approved",
    accountNameMax: 120,
    subtitle: BANK_CHANGE_APPROVER_HR,
    pendingText: BANK_CHANGE_PENDING_HR,
    successToast: BANK_CHANGE_TOAST_HR,
    buildPhotoPath: bookBankPath,
  },
  // Spec 321 U8a — the admin/office login bank is INSTANT (no approval).
  user: {
    tierMode: "instant",
    accountNameMax: 120,
    subtitle: BANK_INSTANT_SUBTITLE,
    pendingText: BANK_CHANGE_PENDING_HR,
    successToast: BANK_INSTANT_TOAST,
    buildPhotoPath: bookBankPath,
  },
};
