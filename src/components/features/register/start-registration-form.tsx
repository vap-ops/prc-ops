"use client";

// Spec 263 U2 — the START form: a visitor with no registration yet enters
// full_name + phone and taps START, minting a permanent employee ID
// (gift-first, ADR 0061) and landing on the pending workspace. On success the
// page re-renders the pending workspace (server refresh — the row now exists).
//
// 'use client' justified: form input + pending state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startTechnicianRegistration } from "@/lib/register/actions";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function StartRegistrationForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!fullName.trim()) {
      setError("กรุณาระบุชื่อ-นามสกุล");
      return;
    }
    if (!phone.trim()) {
      setError("กรุณาระบุเบอร์โทร");
      return;
    }
    startTransition(async () => {
      const result = await startTechnicianRegistration({ fullName, phone });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">สมัครเป็นช่าง</p>
      <p className="text-ink-muted mt-0.5 text-xs">กรอกชื่อและเบอร์โทรเพื่อรับรหัสพนักงานทันที</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อ-นามสกุล
        <input
          value={fullName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setFullName(e.target.value);
            setError(null);
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
            setError(null);
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
        {pending ? "กำลังสมัคร…" : "เริ่มสมัคร"}
      </button>
    </div>
  );
}
