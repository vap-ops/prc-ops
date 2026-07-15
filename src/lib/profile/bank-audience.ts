// Spec 321 U2 — per-audience config for the ONE ProfileBankSection, isolating
// the handful of differences the 4 former clone bank-change forms carried. All
// four upload the passbook to the same CONTACT_DOCS_BUCKET; only the storage
// PATH builder, the accountName length cap, and the approver copy differ. The
// submit action itself is dispatched server-side (submit-profile-bank-change).
// (Copy is preserved verbatim from the clones; U7 will single-source it.)

import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { buildContactDocPath } from "@/lib/contacts/document-path";
import { type PhotoExt } from "@/lib/photos/path";

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

const WAIT_PM = "คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ";
const WAIT_HR = "คำขอเปลี่ยนบัญชีธนาคารกำลังรอการอนุมัติ";
const SUBTITLE_PM = "ผู้จัดการจะตรวจสอบก่อนใช้งานจริง";
const SUBTITLE_HR = "ฝ่ายบุคคลจะตรวจสอบก่อนใช้งานจริง";
const TOAST_PM = "ส่งคำขอแล้ว รอผู้จัดการอนุมัติ";
const TOAST_HR = "ส่งคำขอแล้ว รอการอนุมัติ";

const bookBankPath = (uid: string, attachmentId: string, ext: PhotoExt) =>
  buildTechnicianDocPath(uid, "book_bank", attachmentId, ext);

export const BANK_AUDIENCE: Record<BankAudience, BankAudienceConfig> = {
  worker: {
    accountNameMax: 120,
    subtitle: SUBTITLE_PM,
    pendingText: WAIT_PM,
    successToast: TOAST_PM,
    buildPhotoPath: bookBankPath,
  },
  contractor: {
    accountNameMax: 200,
    subtitle: SUBTITLE_PM,
    pendingText: WAIT_PM,
    successToast: TOAST_PM,
    buildPhotoPath: (id, attachmentId, ext) =>
      buildContactDocPath("contractor", id, attachmentId, ext),
  },
  staff: {
    accountNameMax: 120,
    subtitle: SUBTITLE_HR,
    pendingText: WAIT_HR,
    successToast: TOAST_HR,
    buildPhotoPath: bookBankPath,
  },
  user: {
    accountNameMax: 120,
    subtitle: SUBTITLE_HR,
    pendingText: WAIT_HR,
    successToast: TOAST_HR,
    buildPhotoPath: bookBankPath,
  },
};
