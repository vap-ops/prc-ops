"use client";

// Spec 263 U2 — the applicant's progressive self-edit form (full_name, phone,
// date_of_birth, emergency contact name/relation/phone). Mirrors
// WorkerProfileEdit's shape (spec 170 U4b): direct-apply via
// update_own_technician_registration, pending-only (RPC re-scopes + refuses
// once approved/rejected).
//
// 'use client' justified: form + pending state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnTechnicianRegistration } from "@/lib/register/actions";
import { validateRegistrationProfile } from "@/lib/register/registration-profile";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export interface RegistrationFormInitial {
  fullName: string;
  phone: string;
  dob: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

export function RegistrationForm({ initial }: { initial: RegistrationFormInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [dob, setDob] = useState(initial.dob);
  const [emergencyName, setEmergencyName] = useState(initial.emergencyName);
  const [emergencyRelation, setEmergencyRelation] = useState(initial.emergencyRelation);
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergencyPhone);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const payload = { fullName, phone, dob, emergencyName, emergencyRelation, emergencyPhone };
    const v = validateRegistrationProfile(payload);
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await updateOwnTechnicianRegistration(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  const clear = () => setError(null);

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">ข้อมูลของฉัน</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อ-นามสกุล
        <input
          value={fullName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setFullName(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทร
        <input
          value={phone}
          maxLength={50}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => {
            setPhone(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        วันเกิด
        <input
          type="date"
          value={dob}
          disabled={pending}
          onChange={(e) => {
            setDob(e.target.value);
            clear();
          }}
          className={`${FIELD_STACKED} appearance-none`}
        />
      </label>

      <p className="text-ink mt-4 text-sm font-semibold">ผู้ติดต่อฉุกเฉิน</p>
      <label className="text-ink-secondary mt-2 block text-sm">
        ชื่อ
        <input
          value={emergencyName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setEmergencyName(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ความสัมพันธ์
        <input
          value={emergencyRelation}
          maxLength={60}
          disabled={pending}
          onChange={(e) => {
            setEmergencyRelation(e.target.value);
            clear();
          }}
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
          onChange={(e) => {
            setEmergencyPhone(e.target.value);
            clear();
          }}
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
