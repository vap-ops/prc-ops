"use client";

// Spec 317 U2/U1 — an approved office staffer edits their own CONTACT fields
// (instant tier, update_own_staff_contact). The RPC is coalesce-keep (blank =
// keep the stored value) — the form says so and offers no clear-field gesture.
// 'use client': form state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnStaffContact } from "@/app/settings/my-info/actions";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export interface StaffContactInitial {
  phone: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

export function StaffContactForm({
  initial,
  bare = false,
  onSaved,
}: {
  initial: StaffContactInitial;
  // Spec 321 U3b — hosted inside a BottomSheet (edit-in-modal, decision 6): drop
  // the card chrome + redundant heading and close the sheet on save.
  bare?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(initial.phone);
  const [emergencyName, setEmergencyName] = useState(initial.emergencyName);
  const [emergencyRelation, setEmergencyRelation] = useState(initial.emergencyRelation);
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergencyPhone);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updateOwnStaffContact({
        phone,
        emergencyName,
        emergencyRelation,
        emergencyPhone,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className={bare ? "" : CARD}>
      {bare ? null : <p className="text-ink text-sm font-semibold">ข้อมูลติดต่อ</p>}
      <p className={`text-ink-muted text-xs ${bare ? "mb-3" : "mt-0.5"}`}>เว้นว่าง = คงค่าเดิม</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทร
        <input
          value={phone}
          maxLength={50}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => {
            setPhone(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ผู้ติดต่อฉุกเฉิน
        <input
          value={emergencyName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => setEmergencyName(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ความสัมพันธ์
        <input
          value={emergencyRelation}
          maxLength={60}
          disabled={pending}
          onChange={(e) => setEmergencyRelation(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทรฉุกเฉิน
        <input
          value={emergencyPhone}
          maxLength={50}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => setEmergencyPhone(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      {error ? (
        <p role="alert" className={`mt-3 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={`mt-4 w-full ${BUTTON_PRIMARY}`}
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </div>
  );
}
