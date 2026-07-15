"use client";

// Spec 320 U2 — the per-row reclaim on the PM worklist: clear a worker's active
// payout nominee (used once the worker registers their own account). Confirms
// first (it removes the routing override), then relays to clearPayoutNominee.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPayoutNominee } from "@/app/settings/payout-nominees/actions";
import { PAYOUT_NOMINEE_CLEAR } from "@/lib/i18n/labels";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_SECONDARY_MUTED } from "@/lib/ui/classes";

export function ClearNomineeButton({ workerId }: { workerId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function clear() {
    startTransition(async () => {
      const result = await clearPayoutNominee(workerId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("ล้างบัญชีตัวแทนแล้ว");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(true)}
        className={BUTTON_SECONDARY_MUTED}
      >
        {PAYOUT_NOMINEE_CLEAR}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={clear}
      className={`${BUTTON_SECONDARY_MUTED} text-danger`}
    >
      {pending ? "กำลังล้าง…" : "ยืนยันล้าง?"}
    </button>
  );
}
