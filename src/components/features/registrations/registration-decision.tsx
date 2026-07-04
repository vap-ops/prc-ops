"use client";

// Spec 263 U3 — the back-office approve/reject control on a registration's
// review detail. Approve is a single tap (the RPC's floor asserts full_name +
// id_card; a denial surfaces as the Thai-mapped error). Reject requires a
// non-blank reason (spec doc: reject_technician_registration takes p_reason;
// the U3 brief requires the UI to demand one) — the reason textarea only
// appears once "ปฏิเสธ" is tapped, mirroring a confirm-step rather than a
// silent one-tap reject (the action is not reversible: no re-application,
// spec 263 "out of scope").
//
// 'use client' justified: pending state, local reject-reason input, and the
// server-action calls.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveTechnicianRegistration,
  rejectTechnicianRegistration,
} from "@/app/registrations/actions";
import { validateRejectReason } from "@/lib/register/reject-reason";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export function RegistrationDecision({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveTechnicianRegistration({ registrationId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("อนุมัติแล้ว");
      router.refresh();
    });
  }

  function submitReject() {
    const reasonError = validateRejectReason(reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rejectTechnicianRegistration({ registrationId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ปฏิเสธแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!showReject ? (
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={approve} className={BUTTON_PRIMARY}>
            อนุมัติ
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowReject(true)}
            className={BUTTON_SECONDARY}
          >
            ปฏิเสธ
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="reject-reason" className="text-ink text-sm font-medium">
            เหตุผลที่ปฏิเสธ
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={FIELD_STACKED}
            placeholder="ระบุเหตุผล เช่น เอกสารไม่ครบ"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submitReject}
              className={BUTTON_PRIMARY}
            >
              ยืนยันปฏิเสธ
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowReject(false);
                setError(null);
              }}
              className={BUTTON_SECONDARY}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
