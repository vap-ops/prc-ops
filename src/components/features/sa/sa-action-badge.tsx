"use client";

// Spec 218 — the "ต้องแก้ไข" count riding the SA's หน้าหลัก (/sa) tab, so a WP the
// PM/defect bounced back is visible from anywhere in the app (mirrors the PM's
// PendingApprovalsBadge). Self-fetching island, RLS-scoped (same visibility as the
// /sa section it counts); best-effort — any read failure leaves it hidden.
//
// Count = rework WPs + pending_approval WPs whose LATEST decision is negative
// (ให้แก้ไข / ไม่อนุมัติ). The latest-decision reduce is inlined (the canonical
// helper is server-only and can't cross into this client island).

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/browser";
import { ApprovalsBadge } from "@/components/features/dashboard/pending-approvals-badge";

async function loadSaActionCount(): Promise<number | null> {
  const supabase = createClient();
  const [reworkRes, pendingRes] = await Promise.all([
    supabase
      .from("work_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "rework"),
    supabase.from("work_packages").select("id").eq("status", "pending_approval"),
  ]);
  const reworkCount = reworkRes.count ?? 0;
  const pendingIds = (pendingRes.data ?? []).map((w) => w.id);
  if (pendingIds.length === 0) return reworkCount;

  const { data: approvals } = await supabase
    .from("approvals")
    .select("work_package_id, decision, decided_at")
    .in("work_package_id", pendingIds);

  // Latest decision per WP (max decided_at), then count the negative ones.
  const latest = new Map<string, { decision: string; decided_at: string }>();
  for (const a of approvals ?? []) {
    const cur = latest.get(a.work_package_id);
    if (!cur || a.decided_at > cur.decided_at) {
      latest.set(a.work_package_id, { decision: a.decision, decided_at: a.decided_at });
    }
  }
  let bounced = 0;
  for (const d of latest.values()) {
    if (d.decision === "needs_revision" || d.decision === "rejected") bounced += 1;
  }
  return reworkCount + bounced;
}

export function SaActionBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const n = await loadSaActionCount();
        if (alive && typeof n === "number") setCount(n);
      } catch {
        // best-effort badge — leave hidden on any read failure.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return <ApprovalsBadge count={count} label="ต้องแก้ไข" />;
}
