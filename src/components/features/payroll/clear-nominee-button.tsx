"use client";

// Spec 320 U2 — the per-row reclaim on the PM worklist: clear a worker's active
// payout nominee (used once the worker registers their own account). Confirms
// first (it removes the routing override), then relays to clearPayoutNominee.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPayoutNominee } from "@/app/settings/payout-nominees/actions";
import { PAYOUT_NOMINEE_CLEAR } from "@/lib/i18n/labels";
import { useToast } from "@/lib/ui/use-toast";
// The armed confirm composes the LAYOUT half + its own ink. Writing
// `${BUTTON_SECONDARY_MUTED} text-danger` looked right but rendered NEUTRAL:
// that constant sets `text-ink`, which the generated stylesheet emits after
// `text-danger` and therefore wins. Going through the layout half keeps the
// geometry and elevation identical between the idle and armed states — the two
// are the same control — while letting the armed one own its colour.
// See tests/unit/ui-class-contracts.test.tsx.
import { BUTTON_SECONDARY_MUTED, BUTTON_SECONDARY_MUTED_LAYOUT } from "@/lib/ui/classes";

const CONFIRM_ARMED = `${BUTTON_SECONDARY_MUTED_LAYOUT} border-edge bg-card text-danger`;

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
    <button type="button" disabled={pending} onClick={clear} className={CONFIRM_ARMED}>
      {pending ? "กำลังล้าง…" : "ยืนยันล้าง?"}
    </button>
  );
}
