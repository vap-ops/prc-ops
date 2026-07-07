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

  async function mark(groups: ReadonlyArray<MarkPresentGroup>) {
    const work = groups.filter((g) => g.workerIds.length > 0);
    if (work.length === 0) return;
    setBusy(true);
    try {
      let anyOk = false;
      for (const g of work) {
        const r = await logLaborDays({
          workPackageId: g.workPackageId,
          revalidate,
          workDate: dateIso,
          entries: g.workerIds.map((workerId) => ({ workerId, fraction: "full" as const })),
        });
        if (r.ok) anyOk = true;
      }
      if (anyOk) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return { busy, mark };
}
