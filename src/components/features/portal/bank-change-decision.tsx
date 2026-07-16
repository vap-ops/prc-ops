"use client";

// Spec 130 U4 — PM approve/reject control for a pending DC bank-change request,
// rendered on the contractor contact-detail page. Approve applies the proposed
// bank to the live contact_bank (decide RPC); reject discards it. 'use client':
// pending state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  decideBankChange,
  decideIdentityChange,
  decideStaffBankChange,
  decideWorkerBankChange,
} from "@/lib/portal/actions";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

// Spec 170 U4c-2 — the merged queue holds both contractor and worker requests;
// `kind` routes the decision to the matching decide RPC (contractor → contact_bank,
// worker → workers.bank_*). Defaults to "contractor" so the contractor detail-page
// call site is unchanged.
export function BankChangeDecision({
  requestId,
  revalidate,
  kind = "contractor",
}: {
  requestId: string;
  revalidate: string;
  kind?: "contractor" | "worker" | "staff-bank" | "identity";
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "identity"
          ? await decideIdentityChange({ id: requestId, approve, revalidate })
          : kind === "staff-bank"
            ? await decideStaffBankChange({ id: requestId, approve, revalidate })
            : kind === "worker"
              ? await decideWorkerBankChange({ id: requestId, approve, revalidate })
              : await decideBankChange({ id: requestId, approve, revalidate });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(approve ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className={BUTTON_PRIMARY_COMPACT}
        >
          อนุมัติ
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false)}
          className={BUTTON_SECONDARY_COMPACT}
        >
          ปฏิเสธ
        </button>
      </div>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
