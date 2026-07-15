"use client";

// Spec 317 U2/U3 — propose a legal-name / national-ID / DOB change (the
// APPROVED tier: lands PENDING for the staff-approval trio; one approve applies
// to every linked record). At least one field required; a light 13-digit shape
// check runs here, the mod-11 checksum in the RPC. While a request is pending
// the form is replaced by a waiting notice.
// 'use client': form state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitIdentityChange } from "@/app/settings/my-info/actions";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { PendingChangeNotice } from "@/components/features/profile/pending-change-notice";
import { IDENTITY_CHANGE_PENDING, IDENTITY_CHANGE_TOAST } from "@/lib/i18n/labels";

export function IdentityChangeForm({ hasPending }: { hasPending: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [dob, setDob] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (hasPending) {
    return <PendingChangeNotice>{IDENTITY_CHANGE_PENDING}</PendingChangeNotice>;
  }

  function submit() {
    setError(null);
    const name = fullName.trim();
    const nid = nationalId.replace(/[\s-]/g, "");
    if (!name && !nid && !dob) {
      setError("กรุณากรอกอย่างน้อยหนึ่งรายการที่ต้องการแก้ไข");
      return;
    }
    if (nid && !/^\d{13}$/.test(nid)) {
      setError("เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก");
      return;
    }
    startTransition(async () => {
      const result = await submitIdentityChange({ fullName: name, nationalId: nid, dob });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(IDENTITY_CHANGE_TOAST);
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">ขอแก้ไขข้อมูลตัวตน</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        ชื่อ เลขบัตร และวันเกิด ต้องผ่านการอนุมัติก่อนมีผล — กรอกเฉพาะรายการที่ต้องการแก้
      </p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อ-นามสกุลใหม่
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
        เลขบัตรประชาชนใหม่
        <input
          value={nationalId}
          maxLength={17}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => {
            setNationalId(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        วันเกิดใหม่
        <input
          type="date"
          value={dob}
          disabled={pending}
          onChange={(e) => {
            setDob(e.target.value);
            setError(null);
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
        {pending ? "กำลังส่ง…" : "ส่งคำขอแก้ไขข้อมูลตัวตน"}
      </button>
    </div>
  );
}
