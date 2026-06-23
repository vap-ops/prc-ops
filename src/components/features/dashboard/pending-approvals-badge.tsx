"use client";

// Spec 183 U3 — the pending-approval count badge on the ภาพรวม nav. The literal
// "notification of how many approvals are pending" the operator asked for: a
// small count that rides the home tab so the PM sees waiting work while
// anywhere in the app, not only on the dashboard itself.
//
// 'use client' is justified: it self-fetches the count via the browser client
// (anon key, RLS-scoped — same visibility as the /review queue) so it does not
// need the count threaded through every page's PageShell. The read is
// best-effort: any failure leaves the badge hidden (count 0), never blocks nav.
//
// Only rendered for the PM tier (the parent gates on role) — site_admin shares
// the ภาพรวม tab but does not approve, so it gets no badge.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/browser";

// Pure: the count → label. Hidden (null) at zero, capped at 99+ so the pill
// never blows out the tab. Exported for unit tests.
export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

// Presentational — renders the pill (or nothing) for a given count. Absolutely
// positioned by the parent over the tab icon.
export function ApprovalsBadge({ count }: { count: number }) {
  const label = formatBadgeCount(count);
  if (label === null) return null;
  return (
    <span
      aria-label={`รอตรวจ ${count} รายการ`}
      className="bg-attn text-on-attn pointer-events-none absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold"
    >
      {label}
    </span>
  );
}

// Self-fetching island. Reads the pending-approval count once on mount (RLS
// scopes it to the caller's visible WPs, matching /review), then renders the
// pill. Best-effort: errors leave it hidden.
export function PendingApprovalsBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { count: pending } = await supabase
          .from("work_packages")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval");
        if (alive && typeof pending === "number") setCount(pending);
      } catch {
        // Best-effort badge — leave hidden on any read failure.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return <ApprovalsBadge count={count} />;
}
