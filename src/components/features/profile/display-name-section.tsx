"use client";

// Spec 321 U5 — DisplayNameSection: the read-only + edit-in-modal wrapper for the
// display name on detail/home pages (/profile, /settings/my-info), enforcing the
// operator's decision 6 (detail pages don't host inline edit forms). Shows the
// current name as a read row + an แก้ไข control that opens the existing
// DisplayNameForm inside the shared BottomSheet. (coming-soon keeps the inline
// form — it is a role-home landing, not a detail page.)

import { useState } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { DisplayNameForm } from "@/components/features/common/display-name-form";
import { BUTTON_SECONDARY_MUTED, CARD } from "@/lib/ui/classes";

export function DisplayNameSection({ initialName }: { initialName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={CARD}>
      <p className="text-ink-muted text-xs">ชื่อที่แสดง</p>
      {initialName.trim() ? (
        <p className="text-ink mt-0.5 text-sm font-medium">{initialName}</p>
      ) : (
        <p className="text-ink-secondary mt-0.5 text-sm">ยังไม่ได้ตั้งชื่อที่แสดง</p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-3 w-full ${BUTTON_SECONDARY_MUTED}`}
      >
        แก้ไข
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="ชื่อที่แสดง">
        <DisplayNameForm initialName={initialName} bare onSaved={() => setOpen(false)} />
      </BottomSheet>
    </div>
  );
}
