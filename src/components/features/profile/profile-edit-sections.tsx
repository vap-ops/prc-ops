// Spec 321 U4a — <ProfileEditSections audience>: the shared, ordered profile-edit
// block for the canonical door /settings/my-info. It composes the same section
// components every surface already uses (read card + edit-in-sheet, decision 6)
// in ONE fixed order with consistent headings, so the door's composition can no
// longer drift across audiences. Server Component — the interactive bits are the
// already-'use client' children.
//
// Scope (spec 321 U4, operator "shared component + keep homes"): this owns the
// two audiences /settings/my-info renders inline — "staff" (office approved
// registration: contact + ID-card + bank) and "user" (login-keyed instant bank).
// Bound ช่าง / contractor still edit contact + bank on their own portal
// (/technician, /portal); my-info links out for those and owns display-name +
// identity for everyone — those stay page-level, not in this block.

import { SECTION_HEADING } from "@/lib/ui/classes";
import { ProfileContactSection } from "@/components/features/profile/profile-contact-section";
import { ProfileBankSection } from "@/components/features/profile/profile-bank-section";
import { WorkerIdCardUpdate } from "@/components/features/portal/worker-id-card-update";

type BankFields = { bankName: string; accountNo: string; accountName: string };

type StaffProps = {
  audience: "staff";
  /** owner uid — bank change + ID-card upload are keyed to it. */
  uid: string;
  contact: {
    phone: string;
    emergencyName: string;
    emergencyRelation: string;
    emergencyPhone: string;
  };
  idCardUrl: string | null;
  bank: BankFields | null;
  hasPendingBank: boolean;
};

type UserProps = {
  audience: "user";
  uid: string;
  bank: BankFields | null;
};

export function ProfileEditSections(props: StaffProps | UserProps) {
  if (props.audience === "staff") {
    return (
      <>
        <h2 className={SECTION_HEADING}>ข้อมูลติดต่อ</h2>
        <ProfileContactSection audience="staff" current={props.contact} />

        <h2 className={SECTION_HEADING}>เอกสาร</h2>
        <WorkerIdCardUpdate uid={props.uid} currentUrl={props.idCardUrl} />

        <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
        <ProfileBankSection
          audience="staff"
          ownerId={props.uid}
          current={props.bank}
          hasPending={props.hasPendingBank}
        />
      </>
    );
  }

  // Login-keyed bank home (spec 319 / 321 U8a) — INSTANT edit-in-sheet, no queue.
  return (
    <>
      <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
      <ProfileBankSection
        audience="user"
        ownerId={props.uid}
        current={props.bank}
        showEmptyState
        hasPending={false}
      />
    </>
  );
}
