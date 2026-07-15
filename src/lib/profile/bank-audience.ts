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
} from "@/lib/i18n/labels";

export type BankAudience = "worker" | "contractor" | "staff" | "user";

export interface BankAudienceConfig {
  /** accountName input cap — contractor 200, everyone else 120. */
  accountNameMax: number;
  /** who reviews the change ("...จะตรวจสอบก่อนใช้งานจริง"). */
  subtitle: string;
  /** waiting banner shown while a request is pending. */
  pendingText: string;
  /** success toast after submit. */
  successToast: string;
  /** builds the caller-owned passbook storage path (bucket is always CONTACT_DOCS_BUCKET). */
  buildPhotoPath: (ownerId: string, attachmentId: string, ext: PhotoExt) => string | null;
}

const bookBankPath = (uid: string, attachmentId: string, ext: PhotoExt) =>
  buildTechnicianDocPath(uid, "book_bank", attachmentId, ext);

export const BANK_AUDIENCE: Record<BankAudience, BankAudienceConfig> = {
  worker: {
    accountNameMax: 120,
    subtitle: BANK_CHANGE_APPROVER_PM,
    pendingText: BANK_CHANGE_PENDING_PM,
    successToast: BANK_CHANGE_TOAST_PM,
    buildPhotoPath: bookBankPath,
  },
  contractor: {
    accountNameMax: 200,
    subtitle: BANK_CHANGE_APPROVER_PM,
    pendingText: BANK_CHANGE_PENDING_PM,
    successToast: BANK_CHANGE_TOAST_PM,
    buildPhotoPath: (id, attachmentId, ext) =>
      buildContactDocPath("contractor", id, attachmentId, ext),
  },
  staff: {
    accountNameMax: 120,
    subtitle: BANK_CHANGE_APPROVER_HR,
    pendingText: BANK_CHANGE_PENDING_HR,
    successToast: BANK_CHANGE_TOAST_HR,
    buildPhotoPath: bookBankPath,
  },
  user: {
    accountNameMax: 120,
    subtitle: BANK_CHANGE_APPROVER_HR,
    pendingText: BANK_CHANGE_PENDING_HR,
    successToast: BANK_CHANGE_TOAST_HR,
    buildPhotoPath: bookBankPath,
  },
};
