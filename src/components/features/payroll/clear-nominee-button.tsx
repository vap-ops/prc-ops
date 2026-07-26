"use client";

// Spec 320 U2 — the per-row reclaim on the PM worklist: clear a worker's active
// payout nominee (used once the worker registers their own account). Confirms
// first (it removes the routing override), then relays to clearPayoutNominee.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPayoutNominee } from "@/app/settings/payout-nominees/actions";
import { PAYOUT_NOMINEE_CLEAR } from "@/lib/i18n/labels";
import { useToast } from "@/lib/ui/use-toast";
// The armed confirm uses the repo's destructive-outline primitive rather than
// BUTTON_SECONDARY_MUTED + `text-danger`: that constant sets `text-ink`, which
// outranks `text-danger` in the generated stylesheet, so the confirm rendered
// neutral. See tests/unit/ui-class-contracts.test.tsx.
import { BUTTON_DANGER_OUTLINE_COMPACT, BUTTON_SECONDARY_MUTED } from "@/lib/ui/classes";

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
      className={BUTTON_DANGER_OUTLINE_COMPACT}
    >
      {pending ? "กำลังล้าง…" : "ยืนยันล้าง?"}
    </button>
  );
}
