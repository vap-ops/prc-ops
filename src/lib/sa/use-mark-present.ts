"use client";

// Spec 277 P0 — shared "มาทำ" logging hook. The แผนวันนี้ worklist (per-worker /
// per-งานย่อย) and the muster strip ("ทั้งหมดมาทำ", every absent worker at once) both
// mark planned crew present through the SAME existing logLaborDays action
// (log_labor_day stays the source of truth). One hook so the call shape and the
// refresh-on-success behaviour live in one place instead of two copies.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logLaborDays } from "@/lib/labor/actions";

export interface MarkPresentGroup {
  workPackageId: string;
  workerIds: string[];
}

export function useMarkPresent(dateIso: string, revalidate = "/sa") {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Spec 306 — logLaborDays returns ok:true even when every entry was REFUSED
  // (per-worker failures are collected so one duplicate cannot abort the rest
  // of the crew). Reading only `ok` therefore treated a total refusal as a
  // success: refresh, unchanged board, no message — the silent-success class.
  // The money wall makes that the common case, not a rare one, so the outcome
  // has to reach the screen.
  const [error, setError] = useState<string | null>(null);

  async function mark(groups: ReadonlyArray<MarkPresentGroup>) {
    const work = groups.filter((g) => g.workerIds.length > 0);
    if (work.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let logged = 0;
      let firstFailure: string | null = null;
      for (const g of work) {
        const r = await logLaborDays({
          workPackageId: g.workPackageId,
          revalidate,
          workDate: dateIso,
          entries: g.workerIds.map((workerId) => ({ workerId, fraction: "full" as const })),
        });
        if (!r.ok) {
          firstFailure ??= r.error;
          continue;
        }
        // Count WORKERS logged, not calls that returned ok — a call whose every
        // entry failed is not a success.
        logged += g.workerIds.length - r.failed.length;
        firstFailure ??= r.failed[0]?.message ?? null;
      }
      // Refreshing on a total refusal repaints an identical board, which reads
      // as "it worked". Only a real write earns the refresh.
      if (logged > 0) router.refresh();
      else setError(firstFailure);
    } finally {
      setBusy(false);
    }
  }

  return { busy, mark, error };
}
