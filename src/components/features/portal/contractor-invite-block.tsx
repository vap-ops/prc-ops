"use client";

// Spec 130 U5 — PM affordance on the contractor contact page to issue a portal
// invite link. Generates a single-use, 14-day claim token (create_contractor_invite
// via the action) and shows the /portal/claim?token=… URL for the PM to send the
// DC over LINE. If the contractor is already bound to a portal user, there is
// nothing to issue — show the linked state instead.
//
// 'use client': button + the generated-link state + clipboard copy.

import { useState, useTransition } from "react";
import { createContractorInvite } from "@/app/contacts/actions";
import { buildClaimUrl } from "@/lib/portal/claim-url";
import { useToast } from "@/lib/ui/use-toast";
import {
  CARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export function ContractorInviteBlock({
  contractorId,
  alreadyBound,
}: {
  contractorId: string;
  alreadyBound: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await createContractorInvite({ contractorId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl(buildClaimUrl(window.location.origin, result.token));
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("คัดลอกลิงก์แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <section className={CARD}>
      <p className="text-ink text-sm font-semibold">เข้าถึงพอร์ทัล</p>
      {alreadyBound ? (
        <p className="text-done-strong mt-1 text-sm font-medium">เชื่อมบัญชีพอร์ทัลแล้ว</p>
      ) : (
        <>
          <p className="text-ink-muted mt-0.5 text-xs">
            สร้างลิงก์ให้ผู้รับเหมาเข้าใช้พอร์ทัลด้วย LINE (ใช้ได้ครั้งเดียว · หมดอายุใน 14 วัน)
          </p>
          {url ? (
            <div className="mt-3 flex flex-col gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className={FIELD_INPUT}
              />
              <button type="button" onClick={() => void copy()} className={BUTTON_PRIMARY}>
                คัดลอกลิงก์
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={generate}
              className={`mt-3 ${BUTTON_SECONDARY_MUTED}`}
            >
              {pending ? "กำลังสร้าง…" : "สร้างลิงก์เชิญ"}
            </button>
          )}
          {error ? (
            <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
