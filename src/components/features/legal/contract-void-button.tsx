"use client";

// Spec 284 U5 / ADR 0080 — the void control on a contract's detail. 'use client':
// two-step confirm + useTransition + router.refresh. Voiding is irreversible
// (contract_status → 'void'), so a click reveals a confirm button before it relays
// U3's voidContract (SECURITY DEFINER, LEGAL_ROLES).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidContract } from "@/lib/legal/contracts";
import { BUTTON_SECONDARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";

export function ContractVoidButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doVoid() {
    setError(null);
    startTransition(async () => {
      const r = await voidContract(contractId);
      if (r.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={doVoid}
            className="rounded-control border-danger-edge bg-danger-soft text-danger-ink text-body inline-flex min-h-11 items-center justify-center border px-4 py-2 font-semibold transition-colors disabled:opacity-50"
          >
            ยืนยันการทำให้เป็นโมฆะ
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className={BUTTON_SECONDARY_COMPACT}
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={BUTTON_SECONDARY_COMPACT}
        >
          ทำให้เป็นโมฆะ
        </button>
      )}
      {error ? (
        <p role="alert" className={INLINE_ERROR}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
