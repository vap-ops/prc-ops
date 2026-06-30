"use client";

// Spec 233 / ADR 0067 U5 — confirm-claim affordance on /client/claim. Calls the
// claim action (→ claim_client_invite RPC); on success routes to the client
// progress home, on failure shows the Thai reason. Mirrors
// src/components/features/portal/claim-button.tsx. 'use client' justified:
// pending state + the server-action call + the post-success navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimClientInvite } from "@/lib/client-portal/actions";
import { BUTTON_PRIMARY, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function ClientClaimButton({ token }: { token: string }) {
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
            const result = await claimClientInvite({ token });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.replace("/client");
            router.refresh();
          });
        }}
      >
        {pending ? "กำลังดำเนินการ…" : "ยืนยันเข้าชมความคืบหน้าโครงการ"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
