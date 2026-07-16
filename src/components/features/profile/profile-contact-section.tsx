"use client";

// Spec 321 U3b — ProfileContactSection: the read-only + edit-in-bottom-sheet
// wrapper for the CONTACT block on detail/home pages, enforcing the operator's
// decision 6 (no inline edit forms on detail/home — edit opens a sheet). ONE
// shared shell (read card + แก้ไข → shared BottomSheet) over the three genuinely
// divergent audiences: worker & staff carry an emergency contact, a contractor
// carries a business contact (contact person + mailing address). Each audience
// keeps its own validated, column-scoped form body — only the shell + read view
// are unified here (the fields don't merge, so the standardization is the UX
// shell, not one field set).

import { useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  WorkerProfileEdit,
  type WorkerProfileInitial,
} from "@/components/features/portal/worker-profile-edit";
import {
  StaffContactForm,
  type StaffContactInitial,
} from "@/components/features/profile/staff-contact-form";
import { PortalContactInfo } from "@/components/features/portal/portal-contact-info";
import { BUTTON_SECONDARY_MUTED, CARD } from "@/lib/ui/classes";

interface ContractorContactInitial {
  phone: string;
  email: string;
  contactPerson: string;
  mailingAddress: string;
}

type Props =
  | { audience: "worker"; current: WorkerProfileInitial }
  | { audience: "staff"; current: StaffContactInitial }
  | { audience: "contractor"; current: ContractorContactInitial };

const TITLE = "ข้อมูลติดต่อ";

function rowsFor(props: Props): { label: string; value: string }[] {
  switch (props.audience) {
    case "worker":
      return [
        { label: "เบอร์โทร", value: props.current.phone },
        { label: "อีเมล", value: props.current.email },
        { label: "ผู้ติดต่อฉุกเฉิน", value: props.current.emergencyName },
        { label: "ความสัมพันธ์", value: props.current.emergencyRelation },
        { label: "เบอร์โทรฉุกเฉิน", value: props.current.emergencyPhone },
      ];
    case "staff":
      return [
        { label: "เบอร์โทร", value: props.current.phone },
        { label: "ผู้ติดต่อฉุกเฉิน", value: props.current.emergencyName },
        { label: "ความสัมพันธ์", value: props.current.emergencyRelation },
        { label: "เบอร์โทรฉุกเฉิน", value: props.current.emergencyPhone },
      ];
    case "contractor":
      return [
        { label: "ผู้ติดต่อ", value: props.current.contactPerson },
        { label: "เบอร์โทร", value: props.current.phone },
        { label: "อีเมล", value: props.current.email },
        { label: "ที่อยู่", value: props.current.mailingAddress },
      ];
  }
}

function formFor(props: Props, onSaved: () => void): ReactNode {
  switch (props.audience) {
    case "worker":
      return <WorkerProfileEdit initial={props.current} bare onSaved={onSaved} />;
    case "staff":
      return <StaffContactForm initial={props.current} bare onSaved={onSaved} />;
    case "contractor":
      return <PortalContactInfo initial={props.current} bare onSaved={onSaved} />;
  }
}

export function ProfileContactSection(props: Props) {
  const [open, setOpen] = useState(false);
  const rows = rowsFor(props);

  return (
    <div className={CARD}>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 py-1">
            <dt className="text-ink-secondary text-sm">{r.label}</dt>
            <dd className="text-ink min-w-0 text-sm font-medium">
              {r.value.trim() ? (
                r.value
              ) : (
                <span className="text-ink-muted font-normal">ยังไม่ระบุ</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-3 w-full ${BUTTON_SECONDARY_MUTED}`}
      >
        แก้ไข
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={TITLE}>
        {formFor(props, () => setOpen(false))}
      </BottomSheet>
    </div>
  );
}
