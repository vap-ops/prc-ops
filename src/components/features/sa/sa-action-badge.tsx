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

  // Spec 337 U2a — the badge must apply the SAME clear rule as the section it
  // counts (src/lib/sa/action-list.ts): a bounce the SA has already answered with
  // ส่งตรวจอีกครั้ง is waiting on the DECIDER. Without this the badge keeps its
  // count while the ต้องแก้ไข section renders empty — a permanent phantom on the
  // tab bar, which is the opposite of what the unit is for.
  const [{ data: approvals }, { data: resubmits }] = await Promise.all([
    supabase
      .from("approvals")
      .select("id, work_package_id, decision, decided_at")
      .in("work_package_id", pendingIds),
    supabase
      .from("audit_log")
      .select("payload")
      .eq("target_table", "work_packages")
      .in("target_id", pendingIds)
      .eq("payload->>event", "wp_evidence_resubmitted"),
  ]);

  const answeredDecisionIds = new Set(
    (resubmits ?? [])
      .map((r) => (r.payload as { answers_decision_id?: string } | null)?.answers_decision_id)
      .filter((id): id is string => typeof id === "string"),
  );

  // Latest decision per WP (max decided_at, id as the tiebreak — mirrors the
  // RPC's ordering), then count the negative ones the SA has not yet answered.
  const latest = new Map<string, { id: string; decision: string; decided_at: string }>();
  for (const a of approvals ?? []) {
    const cur = latest.get(a.work_package_id);
    if (
      !cur ||
      a.decided_at > cur.decided_at ||
      (a.decided_at === cur.decided_at && a.id > cur.id)
    ) {
      latest.set(a.work_package_id, { id: a.id, decision: a.decision, decided_at: a.decided_at });
    }
  }
  let bounced = 0;
  for (const d of latest.values()) {
    if (d.decision !== "needs_revision" && d.decision !== "rejected") continue;
    if (answeredDecisionIds.has(d.id)) continue;
    bounced += 1;
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
