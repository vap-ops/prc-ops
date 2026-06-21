"use client";

// Spec 170 U4b / ADR 0062 — a DC worker self-edits their portal profile (contact
// + emergency contact + DOB) in one form, prefilled from get_my_worker_profile.
// Direct apply via update_own_worker_profile (column-scoped server-side to these
// six fields — name/day_rate/tax_id stay out of reach). Mirrors the contractor
// PortalContactInfo / PortalSelfEdit pattern.
//
// 'use client': form + pending state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnWorkerProfile } from "@/lib/portal/actions";
import { validateWorkerProfile } from "@/lib/portal/worker-profile";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export interface WorkerProfileInitial {
  phone: string;
  email: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  dob: string;
}

export function WorkerProfileEdit({ initial }: { initial: WorkerProfileInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [emergencyName, setEmergencyName] = useState(initial.emergencyName);
  const [emergencyRelation, setEmergencyRelation] = useState(initial.emergencyRelation);
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergencyPhone);
  const [dob, setDob] = useState(initial.dob);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const payload = { phone, email, emergencyName, emergencyRelation, emergencyPhone, dob };
    const v = validateWorkerProfile(payload);
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await updateOwnWorkerProfile(payload);
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
      <label className="text-ink-secondary block text-sm">
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
        อีเมล
        <input
          value={email}
          maxLength={200}
          inputMode="email"
          disabled={pending}
          onChange={(e) => {
            setEmail(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
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
