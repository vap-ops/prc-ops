"use client";

// Spec 130 U3 — confirm-claim affordance on /portal/claim. Calls the claim
// action (→ claim_contractor_invite RPC); on success routes to the portal, on
// failure shows the Thai reason. 'use client' justified: pending state + the
// server-action call + the post-success navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimContractorInvite } from "@/lib/portal/actions";
import { BUTTON_PRIMARY, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function ClaimButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        className={`w-full ${BUTTON_PRIMARY}`}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await claimContractorInvite({ token });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.replace("/portal");
            router.refresh();
          });
        }}
      >
        {pending ? "กำลังดำเนินการ…" : "ยืนยันรับสิทธิ์เข้าใช้งาน"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
