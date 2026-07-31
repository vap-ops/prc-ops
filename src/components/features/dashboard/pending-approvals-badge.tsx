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
import { AWAITING_SITE_ZONE } from "@/lib/approvals/review-zone";

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

// How often a mounted badge re-reads its count. Operator report 2026-07-31
// ("procurement manager cannot yet see requested PRs instantly"): the island
// read ONCE per mount, and this app is a PWA that field/office users leave open
// for hours — a purchase request raised at 08:49 was still uncounted on screen
// at 11:27. A minute is well under the human latency that matters for a queue
// people check by eye, and the read is a `head: true` count, not a row fetch.
export const BADGE_REFRESH_MS = 60_000;

// Generic self-fetching island. `load` is a stable module-level fetcher (see
// below) so the effect runs once and the schedule is set up once.
// Best-effort throughout: a failed read never clears a good count and never
// blocks nav — the badge simply keeps showing what it last knew.
//
// Exported for unit tests: the network read stays untested, but the REFRESH
// CONTROL FLOW (interval, foreground resume, background skip, unmount cleanup)
// is the half that can silently rot, so it takes an injected `load`.
export function SelfCountBadge({
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
    const read = async () => {
      // A backgrounded PWA costs nothing: the visibilitychange handler below
      // catches it up the moment the user returns.
      if (document.visibilityState === "hidden") return;
      try {
        const n = await load();
        if (alive && typeof n === "number") setCount(n);
      } catch {
        // Best-effort badge — keep the last known count on any read failure.
      }
    };
    void read();
    const timer = setInterval(() => void read(), BADGE_REFRESH_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  return <ApprovalsBadge count={count} position={position} label={label} />;
}

// RLS-scoped head-counts (same visibility as the surface each links to).
//
// Spec 371 U2: this counts the ACTIONABLE zones of work_package_review_queue,
// not bare status='pending_approval'. The old count included un-cured bounces —
// work the site admin owes, which the PM cannot act on — so the badge reported
// a blended 70 where /review shows 52 (operator: "Amount 70 items is misleading,
// how about separating them?"). The view is the one place that predicate lives,
// so this badge and the ภาพรวม hero cannot drift apart. ⚠️ /review does NOT read
// the view yet (it re-derives the rule in TS — spec 371 U3 closes that). Still a
// single head-count: the classification happens in SQL.
async function loadPendingWpApprovals(): Promise<number | null> {
  const { count } = await createClient()
    .from("work_package_review_queue")
    .select("id", { count: "exact", head: true })
    .neq("zone", AWAITING_SITE_ZONE);
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

// Spec 170 U4c-2: ช่าง bank changes — the worker analogue, summed into the
// same total as contractor bank changes.
async function loadPendingWorkerBankChanges(): Promise<number | null> {
  const { count } = await createClient()
    .from("worker_bank_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count;
}

// Spec 188: the TOTAL the PM tier owes for the approval types that have NO tab
// of their own — WP review + contractor-bank + worker-bank. Purchase requests are
// DELIBERATELY EXCLUDED: PR has its own คำขอซื้อ tab (with its own badge), so
// counting it here too double-counted every PR (operator: "showing on คำขอซื้อ
// and ภาพรวม is confusing"). Doctrine: each tab owns its count — a pending item is
// badged in exactly one place. The reads run in parallel; a failed read = 0.
async function loadTotalPendingApprovals(): Promise<number> {
  const [wp, bank, workerBank] = await Promise.all([
    loadPendingWpApprovals(),
    loadPendingBankChanges(),
    loadPendingWorkerBankChanges(),
  ]);
  return sumApprovalCounts([wp, bank, workerBank]);
}

// Spec 183 → 188: the ภาพรวม (home) nav item carries the pending count for the
// tabless approval types (WP review + bank changes) — the ones whose only home is
// the dashboard inbox. PR is NOT here (spec 188): it lives on the คำขอซื้อ tab
// badge. The dashboard shows the breakdown that sums to THIS number.
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
