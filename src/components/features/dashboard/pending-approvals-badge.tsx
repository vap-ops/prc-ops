"use client";

// Spec 183 U3 / spec 184 U1 — count badges on the nav. The literal
// "notification of how many approvals are pending": a count rides the relevant
// nav item so the PM tier sees decisions it owes while anywhere in the app.
//
// 'use client' is justified: each badge self-fetches its count via the browser
// client (anon key, RLS-scoped — same visibility as the surface it links to) so
// the count is not threaded through every page's PageShell. Reads are
// best-effort: any failure leaves the badge hidden (count 0), never blocks nav.
//
// Only rendered for the PM tier (the parent gates on role) — other roles share
// these tabs but don't decide, so they get no badge.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/browser";

// Pure: the count → label. Hidden (null) at zero, capped at 99+ so the pill
// never blows out the tab. Exported for unit tests.
export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

// Pure: sum the per-type pending counts, treating null (a read failure) as 0.
// Exported for unit tests.
export function sumApprovalCounts(values: ReadonlyArray<number | null>): number {
  return values.reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
}

// position: "overlay" (default) sits absolutely over a tab icon (bottom bar);
// "inline" flows after a text label (the desktop hub strip).
type BadgePosition = "overlay" | "inline";

// Presentational — renders the pill (or nothing) for a given count. `label` is
// the aria-label noun (what is pending), so the same pill reads correctly for
// work-package vs purchase-request awareness.
export function ApprovalsBadge({
  count,
  position = "overlay",
  label = "รอตรวจ",
}: {
  count: number;
  position?: BadgePosition;
  label?: string;
}) {
  const text = formatBadgeCount(count);
  if (text === null) return null;
  const place =
    position === "inline" ? "relative ml-1 align-middle" : "absolute -top-1.5 -right-2.5";
  return (
    <span
      aria-label={`${label} ${count} รายการ`}
      className={`bg-attn text-on-attn pointer-events-none ${place} inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold`}
    >
      {text}
    </span>
  );
}

// Generic self-fetching island. `load` is a stable module-level fetcher (see
// below) so the effect runs once. Best-effort: errors leave the badge hidden.
function SelfCountBadge({
  load,
  position = "overlay",
  label = "รอตรวจ",
}: {
  load: () => Promise<number | null>;
  position?: BadgePosition;
  label?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const n = await load();
        if (alive && typeof n === "number") setCount(n);
      } catch {
        // Best-effort badge — leave hidden on any read failure.
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  return <ApprovalsBadge count={count} position={position} label={label} />;
}

// RLS-scoped head-counts (same visibility as the surface each links to).
async function loadPendingWpApprovals(): Promise<number | null> {
  const { count } = await createClient()
    .from("work_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval");
  return count;
}

async function loadPendingPurchaseDecisions(): Promise<number | null> {
  const { count } = await createClient()
    .from("purchase_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "requested");
  return count;
}

async function loadPendingBankChanges(): Promise<number | null> {
  const { count } = await createClient()
    .from("contractor_bank_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count;
}

// Spec 185 U2: the TOTAL the PM tier owes across all approval types (WP + PR +
// bank). The three reads run in parallel; a failed read counts as 0.
async function loadTotalPendingApprovals(): Promise<number> {
  const [wp, pr, bank] = await Promise.all([
    loadPendingWpApprovals(),
    loadPendingPurchaseDecisions(),
    loadPendingBankChanges(),
  ]);
  return sumApprovalCounts([wp, pr, bank]);
}

// Spec 183 → 185 U2: the ภาพรวม (home) nav item carries the TOTAL pending
// approvals across all PM-tier types — the operator's original "how many
// approvals are pending". The dashboard shows the per-type breakdown that sums
// to this number; the คำขอซื้อ tab keeps a PR-only badge (the subset).
export function PendingApprovalsBadge({ position = "overlay" }: { position?: BadgePosition } = {}) {
  return <SelfCountBadge load={loadTotalPendingApprovals} position={position} label="รออนุมัติ" />;
}

// Spec 184 U1: purchase requests awaiting a decision — on the คำขอซื้อ nav item.
export function PendingPurchaseDecisionsBadge({
  position = "overlay",
}: { position?: BadgePosition } = {}) {
  return (
    <SelfCountBadge
      load={loadPendingPurchaseDecisions}
      position={position}
      label="คำขอซื้อรอพิจารณา"
    />
  );
}
